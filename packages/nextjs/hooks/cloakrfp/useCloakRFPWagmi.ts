"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEncrypt, usePublicDecrypt } from "@zama-fhe/react-sdk";
import {
  BaseError,
  ContractFunctionRevertedError,
  bytesToHex,
  decodeAbiParameters,
  isAddressEqual,
  parseEventLogs,
} from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import { readContract } from "wagmi/actions";
import { waitForTransactionReceipt } from "wagmi/actions";
import { CloakRFP } from "~~/contracts/CloakRFP";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";
import { deploymentFor } from "~~/utils/contract";

type ScoringWeightsResult = {
  price: number;
  deliveryDays: number;
  warrantyMonths: number;
  quantity: number;
};

type TenderResult = readonly [
  buyer: `0x${string}`,
  metadataURI: string,
  weights: ScoringWeightsResult,
  hasBest: boolean,
  closed: boolean,
  bestVendor: `0x${string}`,
  bestScore: `0x${string}`,
  pendingVendor: `0x${string}`,
];

export type CreateTenderForm = {
  metadataURI: string;
  priceWeight: number;
  deliveryDaysWeight: number;
  warrantyMonthsWeight: number;
  quantityWeight: number;
};

export type VendorBidForm = {
  price: number;
  deliveryDays: number;
  warrantyMonths: number;
  quantity: number;
};

type BidStatus = "idle" | "encrypting" | "awaiting-wallet" | "submitting" | "confirmed" | "error";
type ResolveStatus = "idle" | "ready" | "decrypting" | "awaiting-wallet" | "resolving" | "confirmed" | "error";
type CloseStatus = "idle" | "awaiting-wallet" | "closing" | "confirmed" | "error";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const isTenderNotFound = (error: unknown) => {
  if (!error) return false;
  const walk = (current: unknown): boolean => {
    if (!current || typeof current !== "object") return false;
    if (current instanceof ContractFunctionRevertedError && current.data?.errorName === "TenderNotFound") return true;
    if ("cause" in current) return walk((current as { cause?: unknown }).cause);
    return false;
  };
  return walk(error) || (error instanceof Error && error.message.includes("TenderNotFound"));
};

const isRpcConnectionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message.includes("HTTP request failed") ||
    message.includes("Failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("NetworkError") ||
    message.includes("ECONNREFUSED") ||
    message.includes("Could not connect")
  );
};

const formatError = (error: unknown) => {
  if (isRpcConnectionError(error)) {
    return "Could not reach local chain. Make sure pnpm chain is running, then refresh.";
  }
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return String(error);
};

const shortErrorMessage = (error: unknown) => {
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return String(error);
};

const toHexBytes = (value: unknown, label: string) => {
  if (typeof value === "string" && value.startsWith("0x")) return value as `0x${string}`;
  if (value instanceof Uint8Array) return bytesToHex(value);
  throw new Error(`${label} was not returned as hex bytes`);
};

const formatBidError = (error: unknown, tenderLabel: string) => {
  const message = formatError(error);
  if (message.includes("User rejected") || message.includes("rejected the request")) {
    return "Wallet confirmation was cancelled.";
  }
  if (message.includes("BidAlreadySubmitted")) {
    return `This wallet has already submitted a bid for ${tenderLabel}.`;
  }
  if (message.includes("TenderClosedForBids")) {
    return "This tender is closed. New encrypted bids are disabled.";
  }
  if (message.includes("TenderNotFound")) {
    return `${tenderLabel} is not available yet.`;
  }
  if (message.includes("PendingBestResolutionRequired")) {
    return "A pending encrypted comparison must be resolved before another bid can be accepted.";
  }
  if (message.includes("InvalidType") || message.includes("SenderNotAllowedToUseHandle")) {
    return "Encrypted bid proof was rejected by the contract.";
  }
  if (message.length > 160) return "Encrypted bid submission failed. Check the wallet and local chain, then try again.";
  return message;
};

const formatResolveError = (error: unknown) => {
  const message = formatError(error);
  if (message.includes("User rejected") || message.includes("rejected the request")) {
    return "Wallet confirmation cancelled.";
  }
  if (message.includes("NoPendingBest") || message.includes("TenderNotFound")) {
    return "Pending comparison not found.";
  }
  if (message.includes("TenderAlreadyClosed")) {
    return "This tender is closed. Pending comparison resolution is disabled.";
  }
  if (isRpcConnectionError(error)) {
    return "Could not reach local chain. Make sure pnpm chain is running, then refresh.";
  }
  const shortMessage = shortErrorMessage(error);
  if (shortMessage && shortMessage.length <= 140) return `Resolve failed: ${shortMessage}`;
  return "Resolve failed: refresh tender state, then try again.";
};

const formatCloseError = (error: unknown) => {
  const message = formatError(error);
  if (message.includes("User rejected") || message.includes("rejected the request")) {
    return "Wallet confirmation cancelled.";
  }
  if (message.includes("OnlyTenderBuyer")) {
    return "Only the tender buyer can finalize this tender.";
  }
  if (message.includes("NoBestVendor")) {
    return "Cannot finalize until a current best vendor exists.";
  }
  if (message.includes("PendingBestResolutionRequired")) {
    return "Resolve the pending encrypted comparison before finalizing.";
  }
  if (message.includes("TenderAlreadyClosed")) {
    return "Tender is already closed.";
  }
  if (message.includes("TenderNotFound")) {
    return "Tender not found.";
  }
  const shortMessage = shortErrorMessage(error);
  if (shortMessage && shortMessage.length <= 140) return `Finalize failed: ${shortMessage}`;
  return "Finalize failed: refresh tender state, then try again.";
};

export const useCloakRFPWagmi = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const cloakRFP = useMemo(() => deploymentFor(CloakRFP, chainId), [chainId]);
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const encrypt = useEncrypt();
  const publicDecrypt = usePublicDecrypt();
  const [message, setMessage] = useState("");
  const [bidMessage, setBidMessage] = useState("");
  const [bidStatus, setBidStatus] = useState<BidStatus>("idle");
  const [resolveMessage, setResolveMessage] = useState("");
  const [resolveStatus, setResolveStatus] = useState<ResolveStatus>("idle");
  const [closeMessage, setCloseMessage] = useState("");
  const [closeStatus, setCloseStatus] = useState<CloseStatus>("idle");
  const [isWaitingForReceipt, setIsWaitingForReceipt] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isSubmittingBid, setIsSubmittingBid] = useState(false);
  const [isResolvingPendingBest, setIsResolvingPendingBest] = useState(false);
  const [isClosingTender, setIsClosingTender] = useState(false);
  const [selectedTenderId, setSelectedTenderId] = useState<bigint>(0n);

  const hasContract = Boolean(cloakRFP?.address && cloakRFP?.abi);

  const tenderCountRead = useReadContract({
    address: hasContract ? cloakRFP!.address : undefined,
    abi: hasContract ? cloakRFP!.abi : undefined,
    functionName: "nextTenderId",
    query: {
      enabled: hasContract,
      refetchOnWindowFocus: false,
      retry: false,
    },
  });

  const tenderRead = useReadContract({
    address: hasContract ? cloakRFP!.address : undefined,
    abi: hasContract ? cloakRFP!.abi : undefined,
    functionName: "getTender",
    args: [selectedTenderId],
    query: {
      enabled: hasContract,
      refetchOnWindowFocus: false,
      retry: false,
    },
  });

  const tenderCount = (tenderCountRead.data as bigint | undefined) ?? 0n;
  const selectedTenderLabel =
    tenderCountRead.data === undefined || tenderCountRead.data === 0n
      ? "No tender selected"
      : `Tender #${selectedTenderId.toString()}`;
  const tender = tenderRead.data as TenderResult | undefined;
  const tenderMissing = isTenderNotFound(tenderRead.error);
  const countReadError = tenderCountRead.error ? formatError(tenderCountRead.error) : "";
  const tenderReadError = tenderRead.error && !tenderMissing ? formatError(tenderRead.error) : "";
  const readError = countReadError || tenderReadError;

  useEffect(() => {
    if (tenderCount === 0n || selectedTenderId < tenderCount) return;
    setSelectedTenderId(tenderCount - 1n);
  }, [selectedTenderId, tenderCount]);

  const selectTender = useCallback((tenderId: bigint) => {
    setBidMessage("");
    setBidStatus("idle");
    setResolveMessage("");
    setResolveStatus("idle");
    setCloseMessage("");
    setCloseStatus("idle");
    setMessage(`Selected Tender #${tenderId.toString()}.`);
    setSelectedTenderId(tenderId);
  }, []);

  const refreshTenderForSource = useCallback(
    async (source: "create" | "manual") => {
      if (source === "manual") {
        setMessage("Refreshing state...");
        setIsManualRefreshing(true);
      }
      try {
        const [countResult, tenderResult] = await Promise.all([tenderCountRead.refetch(), tenderRead.refetch()]);
        const countError = countResult.error ? formatError(countResult.error) : "";
        if (countError) {
          setMessage(countError);
          return { ok: false, error: countError };
        }
        if (tenderResult.error && !isTenderNotFound(tenderResult.error)) {
          const errorMessage = formatError(tenderResult.error);
          setMessage(errorMessage);
          return { ok: false, error: errorMessage };
        }
        if (tenderResult.error && isTenderNotFound(tenderResult.error)) {
          const errorMessage =
            countResult.data === 0n
              ? "No tenders have been created yet."
              : source === "create"
                ? `Tender confirmed, but ${selectedTenderLabel} is still not available.`
                : `${selectedTenderLabel} has not been created yet.`;
          setMessage(errorMessage);
          return { ok: false, error: errorMessage };
        }
        if (source === "manual") setMessage(`${selectedTenderLabel} state refreshed.`);
        return { ok: true };
      } finally {
        if (source === "manual") setIsManualRefreshing(false);
      }
    },
    [selectedTenderLabel, tenderCountRead, tenderRead],
  );

  const refreshTender = useCallback(() => refreshTenderForSource("manual"), [refreshTenderForSource]);

  const createTender = useCallback(
    async (form: CreateTenderForm) => {
      if (!hasContract || !cloakRFP || !isConnected || !address) return;
      setMessage("Creating tender...");
      try {
        const hash = await writeContractAsync({
          address: cloakRFP.address,
          abi: cloakRFP.abi,
          functionName: "createTender",
          args: [
            form.metadataURI,
            {
              price: form.priceWeight,
              deliveryDays: form.deliveryDaysWeight,
              warrantyMonths: form.warrantyMonthsWeight,
              quantity: form.quantityWeight,
            },
          ],
        });
        setMessage("Tender transaction submitted. Waiting for confirmation...");
        setIsWaitingForReceipt(true);
        const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
        setMessage("Tender confirmed. Refreshing public data...");

        let createdTenderId: bigint | undefined;
        try {
          const createdEvents = parseEventLogs({
            abi: cloakRFP.abi,
            eventName: "TenderCreated",
            logs: receipt.logs.filter(log => isAddressEqual(log.address, cloakRFP.address)),
          });
          createdTenderId = createdEvents.find(event => isAddressEqual(event.args.buyer, address))?.args.tenderId;
        } catch {
          createdTenderId = undefined;
        }

        await tenderCountRead.refetch();

        if (createdTenderId === undefined) {
          setMessage("Tender confirmed, but the created tender ID could not be read. Refresh tender list.");
          return;
        }

        if (createdTenderId === selectedTenderId) await tenderRead.refetch();
        setSelectedTenderId(createdTenderId);
        setMessage(`Tender #${createdTenderId.toString()} confirmed and selected.`);
        return createdTenderId;
      } catch (error) {
        setMessage(`createTender failed: ${formatError(error)}`);
        return undefined;
      } finally {
        setIsWaitingForReceipt(false);
      }
    },
    [address, cloakRFP, hasContract, isConnected, selectedTenderId, tenderCountRead, tenderRead, writeContractAsync],
  );

  const submitBid = useCallback(
    async (form: VendorBidForm) => {
      if (!hasContract || !cloakRFP || !isConnected || !address || !tender || tenderMissing) return false;
      if (tender[4]) {
        setBidStatus("error");
        setBidMessage("This tender is closed. New encrypted bids are disabled.");
        return false;
      }
      if (tender[7] && !isAddressEqual(tender[7], ZERO_ADDRESS)) {
        setBidStatus("error");
        setBidMessage("A pending encrypted comparison must be resolved before another bid can be submitted.");
        return false;
      }
      setIsSubmittingBid(true);
      setBidStatus("encrypting");
      setBidMessage("Encrypting bid fields...");

      try {
        const encryptField = async (value: number) => {
          const encrypted = await encrypt.mutateAsync({
            values: [{ value: BigInt(value), type: "euint32" }],
            contractAddress: cloakRFP.address,
            userAddress: address,
          });

          const handle = encrypted.handles[0];
          if (!handle) throw new Error("Encrypted handle missing");
          return {
            handle: bytesToHex(handle),
            proof: bytesToHex(encrypted.inputProof),
          };
        };

        const price = await encryptField(form.price);
        const deliveryDays = await encryptField(form.deliveryDays);
        const warrantyMonths = await encryptField(form.warrantyMonths);
        const quantity = await encryptField(form.quantity);

        setBidStatus("awaiting-wallet");
        setBidMessage("Waiting for wallet confirmation...");
        const hash = await writeContractAsync({
          address: cloakRFP.address,
          abi: cloakRFP.abi,
          functionName: "submitBid",
          args: [
            selectedTenderId,
            {
              price: price.handle,
              deliveryDays: deliveryDays.handle,
              warrantyMonths: warrantyMonths.handle,
              quantity: quantity.handle,
              priceProof: price.proof,
              deliveryDaysProof: deliveryDays.proof,
              warrantyMonthsProof: warrantyMonths.proof,
              quantityProof: quantity.proof,
            },
          ],
          gas: 15_000_000n,
        });

        setBidStatus("submitting");
        setBidMessage("Submitting encrypted bid. Waiting for confirmation...");
        await waitForTransactionReceipt(wagmiConfig, { hash });
        setBidStatus("confirmed");
        setBidMessage(`Bid confirmed. Refreshing ${selectedTenderLabel}...`);
        const refresh = await refreshTenderForSource("create");
        if (refresh.ok) setBidMessage(`Encrypted bid confirmed and ${selectedTenderLabel} refreshed.`);
        return true;
      } catch (error) {
        setBidStatus("error");
        setBidMessage(formatBidError(error, selectedTenderLabel));
        return false;
      } finally {
        setIsSubmittingBid(false);
      }
    },
    [
      address,
      cloakRFP,
      encrypt,
      hasContract,
      isConnected,
      refreshTenderForSource,
      selectedTenderId,
      selectedTenderLabel,
      tender,
      tenderMissing,
      writeContractAsync,
    ],
  );

  const resolvePendingBest = useCallback(async () => {
    if (!hasContract || !cloakRFP || !isConnected || !tender || tenderMissing) return;
    if (tender[4]) {
      setResolveStatus("error");
      setResolveMessage("This tender is closed. Pending comparison resolution is disabled.");
      return;
    }
    if (!tender[7] || isAddressEqual(tender[7], ZERO_ADDRESS)) {
      setResolveStatus("idle");
      setResolveMessage("Pending comparison not found.");
      return;
    }

    setIsResolvingPendingBest(true);
    setResolveStatus("decrypting");
    setResolveMessage("Decrypting pending comparison...");

    try {
      const pendingComparisonHandle = (await readContract(wagmiConfig, {
        address: cloakRFP.address,
        abi: cloakRFP.abi,
        functionName: "getPendingComparison",
        args: [selectedTenderId, tender[7]],
      })) as `0x${string}`;

      const decrypted = await publicDecrypt.mutateAsync([pendingComparisonHandle]);
      const abiEncodedClearValues = toHexBytes(decrypted.abiEncodedClearValues, "Public decrypt cleartexts");
      const decryptionProof = toHexBytes(decrypted.decryptionProof, "Public decrypt proof");
      const [cleartext] = decodeAbiParameters([{ type: "uint256" }], abiEncodedClearValues);

      if (cleartext > 1n) {
        throw new Error("Invalid public decrypt cleartext");
      }

      console.info("CloakRFP resolvePendingBest public decrypt", {
        pendingComparisonHandle,
        cleartext: cleartext.toString(),
        hasDecryptionProof: decryptionProof !== "0x",
      });

      setResolveStatus("awaiting-wallet");
      setResolveMessage("Waiting for wallet confirmation...");
      const hash = await writeContractAsync({
        address: cloakRFP.address,
        abi: cloakRFP.abi,
        functionName: "resolvePendingBest",
        args: [selectedTenderId, cleartext, decryptionProof],
        gas: 15_000_000n,
      });

      setResolveStatus("resolving");
      setResolveMessage("Resolving encrypted comparison. Waiting for confirmation...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setResolveStatus("confirmed");
      setResolveMessage(`Comparison resolved. Refreshing ${selectedTenderLabel}...`);
      const refresh = await refreshTenderForSource("create");
      if (refresh.ok) setResolveMessage(`Comparison resolved and ${selectedTenderLabel} refreshed.`);
    } catch (error) {
      console.error("CloakRFP resolvePendingBest failed", error);
      setResolveStatus("error");
      setResolveMessage(formatResolveError(error));
    } finally {
      setIsResolvingPendingBest(false);
    }
  }, [
    cloakRFP,
    hasContract,
    isConnected,
    publicDecrypt,
    refreshTenderForSource,
    selectedTenderId,
    selectedTenderLabel,
    tender,
    tenderMissing,
    writeContractAsync,
  ]);

  const closeTender = useCallback(async () => {
    if (!hasContract || !cloakRFP || !isConnected || !tender || tenderMissing) return false;
    if (tender[4]) {
      setCloseStatus("error");
      setCloseMessage("Tender is already closed.");
      return false;
    }
    if (!tender[3] || isAddressEqual(tender[5], ZERO_ADDRESS)) {
      setCloseStatus("error");
      setCloseMessage("Cannot finalize until a current best vendor exists.");
      return false;
    }
    if (tender[7] && !isAddressEqual(tender[7], ZERO_ADDRESS)) {
      setCloseStatus("error");
      setCloseMessage("Resolve the pending encrypted comparison before finalizing.");
      return false;
    }

    setIsClosingTender(true);
    setCloseStatus("awaiting-wallet");
    setCloseMessage("Waiting for wallet confirmation...");

    try {
      const hash = await writeContractAsync({
        address: cloakRFP.address,
        abi: cloakRFP.abi,
        functionName: "closeTender",
        args: [selectedTenderId],
      });

      setCloseStatus("closing");
      setCloseMessage("Finalizing tender. Waiting for confirmation...");
      await waitForTransactionReceipt(wagmiConfig, { hash });
      const refresh = await refreshTenderForSource("create");
      setCloseStatus("confirmed");
      if (refresh.ok) {
        setCloseMessage("Tender finalized and winner locked.");
        setBidMessage("This tender is closed. New encrypted bids are disabled.");
      } else {
        setCloseMessage("Tender finalized. Refresh selected tender to verify final state.");
      }
      return true;
    } catch (error) {
      setCloseStatus("error");
      setCloseMessage(formatCloseError(error));
      return false;
    } finally {
      setIsClosingTender(false);
    }
  }, [
    cloakRFP,
    hasContract,
    isConnected,
    refreshTenderForSource,
    selectedTenderId,
    tender,
    tenderMissing,
    writeContractAsync,
  ]);

  return {
    account: address,
    bidMessage,
    bidStatus,
    chainId,
    closeMessage,
    closeStatus,
    closeTender,
    contractAddress: cloakRFP?.address,
    hasContract,
    isConnected,
    isLoadingTender: tenderRead.isFetching || isManualRefreshing,
    isLoadingTenderCount: tenderCountRead.isFetching,
    isResolvingPendingBest,
    isClosingTender,
    isSubmittingBid,
    isWriting: isWriting || isWaitingForReceipt || isResolvingPendingBest || isClosingTender,
    message,
    readError,
    refreshTender,
    createTender,
    resolveMessage,
    resolvePendingBest,
    resolveStatus:
      resolveStatus === "idle" && tender && !tenderMissing && !tender[4] && !isAddressEqual(tender[7], ZERO_ADDRESS)
        ? "ready"
        : resolveStatus,
    submitBid,
    selectTender,
    selectedTenderId,
    selectedTenderLabel,
    tenderCount,
    tenderIds: Array.from({ length: Number(tenderCount) }, (_, index) => BigInt(index)),
    tenderMissing,
    tender:
      tender && !tenderMissing
        ? {
            buyer: tender[0],
            metadataURI: tender[1],
            weights: {
              price: tender[2].price,
              deliveryDays: tender[2].deliveryDays,
              warrantyMonths: tender[2].warrantyMonths,
              quantity: tender[2].quantity,
            },
            hasBest: tender[3],
            closed: tender[4],
            bestVendor: tender[5],
            bestScore: tender[6],
            pendingVendor: tender[7],
            hasPublicBestVendor: !isAddressEqual(tender[5], ZERO_ADDRESS),
            hasPendingVendor: !isAddressEqual(tender[7], ZERO_ADDRESS),
          }
        : undefined,
  };
};
