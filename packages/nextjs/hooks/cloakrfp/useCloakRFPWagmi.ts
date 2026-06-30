"use client";

import { useCallback, useMemo, useState } from "react";
import { useEncrypt } from "@zama-fhe/react-sdk";
import { BaseError, ContractFunctionRevertedError, isAddressEqual } from "viem";
import { bytesToHex } from "viem";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
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

const TENDER_ID = 0n;
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

const formatBidError = (error: unknown) => {
  const message = formatError(error);
  if (message.includes("User rejected") || message.includes("rejected the request")) {
    return "Wallet confirmation was cancelled.";
  }
  if (message.includes("BidAlreadySubmitted")) {
    return "This wallet has already submitted a bid for tender #0.";
  }
  if (message.includes("TenderNotFound")) {
    return "Tender #0 is not available yet.";
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

export const useCloakRFPWagmi = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const cloakRFP = useMemo(() => deploymentFor(CloakRFP, chainId), [chainId]);
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const encrypt = useEncrypt();
  const [message, setMessage] = useState("");
  const [bidMessage, setBidMessage] = useState("");
  const [bidStatus, setBidStatus] = useState<BidStatus>("idle");
  const [isWaitingForReceipt, setIsWaitingForReceipt] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [isSubmittingBid, setIsSubmittingBid] = useState(false);

  const hasContract = Boolean(cloakRFP?.address && cloakRFP?.abi);

  const tenderRead = useReadContract({
    address: hasContract ? cloakRFP!.address : undefined,
    abi: hasContract ? cloakRFP!.abi : undefined,
    functionName: "getTender",
    args: [TENDER_ID],
    query: {
      enabled: hasContract,
      refetchOnWindowFocus: false,
      retry: false,
    },
  });

  const tender = tenderRead.data as TenderResult | undefined;
  const tenderMissing = isTenderNotFound(tenderRead.error);
  const readError = tenderRead.error && !tenderMissing ? formatError(tenderRead.error) : "";

  const refreshTenderForSource = useCallback(
    async (source: "create" | "manual") => {
      if (source === "manual") {
        setMessage("Refreshing state...");
        setIsManualRefreshing(true);
      }
      try {
        const result = await tenderRead.refetch();
        if (result.error && !isTenderNotFound(result.error)) {
          const errorMessage = formatError(result.error);
          setMessage(errorMessage);
          return { ok: false, error: errorMessage };
        }
        if (result.error && isTenderNotFound(result.error)) {
          const errorMessage =
            source === "create"
              ? "Tender confirmed, but tender 0 is still not available."
              : "Tender #0 has not been created yet.";
          setMessage(errorMessage);
          return { ok: false, error: errorMessage };
        }
        if (source === "manual") setMessage("Tender state refreshed.");
        return { ok: true };
      } finally {
        if (source === "manual") setIsManualRefreshing(false);
      }
    },
    [tenderRead],
  );

  const refreshTender = useCallback(() => refreshTenderForSource("manual"), [refreshTenderForSource]);

  const createTender = useCallback(
    async (form: CreateTenderForm) => {
      if (!hasContract || !cloakRFP || !isConnected) return;
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
        await waitForTransactionReceipt(wagmiConfig, { hash });
        setMessage("Tender confirmed. Refreshing public data...");
        const refresh = await refreshTenderForSource("create");
        if (refresh.ok) setMessage("Tender confirmed and loaded.");
      } catch (error) {
        setMessage(`createTender failed: ${formatError(error)}`);
      } finally {
        setIsWaitingForReceipt(false);
      }
    },
    [cloakRFP, hasContract, isConnected, refreshTenderForSource, writeContractAsync],
  );

  const submitBid = useCallback(
    async (form: VendorBidForm) => {
      if (!hasContract || !cloakRFP || !isConnected || !address || !tender || tenderMissing) return;
      if (tender[6] && !isAddressEqual(tender[6], ZERO_ADDRESS)) {
        setBidStatus("error");
        setBidMessage("A pending encrypted comparison must be resolved before another bid can be submitted.");
        return;
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
            TENDER_ID,
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
        setBidMessage("Bid confirmed. Refreshing tender #0...");
        const refresh = await refreshTenderForSource("create");
        if (refresh.ok) setBidMessage("Encrypted bid confirmed and tender #0 refreshed.");
      } catch (error) {
        setBidStatus("error");
        setBidMessage(formatBidError(error));
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
      tender,
      tenderMissing,
      writeContractAsync,
    ],
  );

  return {
    account: address,
    bidMessage,
    bidStatus,
    chainId,
    contractAddress: cloakRFP?.address,
    hasContract,
    isConnected,
    isLoadingTender: tenderRead.isFetching || isManualRefreshing,
    isSubmittingBid,
    isWriting: isWriting || isWaitingForReceipt,
    message,
    readError,
    refreshTender,
    createTender,
    submitBid,
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
            bestVendor: tender[4],
            bestScore: tender[5],
            pendingVendor: tender[6],
            hasPublicBestVendor: !isAddressEqual(tender[4], ZERO_ADDRESS),
            hasPendingVendor: !isAddressEqual(tender[6], ZERO_ADDRESS),
          }
        : undefined,
  };
};
