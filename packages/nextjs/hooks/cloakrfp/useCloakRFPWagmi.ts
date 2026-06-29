"use client";

import { useCallback, useMemo, useState } from "react";
import { BaseError, ContractFunctionRevertedError, isAddressEqual } from "viem";
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

const formatError = (error: unknown) => {
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const useCloakRFPWagmi = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const cloakRFP = useMemo(() => deploymentFor(CloakRFP, chainId), [chainId]);
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
  const [message, setMessage] = useState("");
  const [isWaitingForReceipt, setIsWaitingForReceipt] = useState(false);

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

  const refreshTender = useCallback(async () => {
    const result = await tenderRead.refetch();
    if (result.error && !isTenderNotFound(result.error)) {
      setMessage(`getTender(0) failed: ${formatError(result.error)}`);
    }
  }, [tenderRead]);

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
        await refreshTender();
      } catch (error) {
        setMessage(`createTender failed: ${formatError(error)}`);
      } finally {
        setIsWaitingForReceipt(false);
      }
    },
    [cloakRFP, hasContract, isConnected, refreshTender, writeContractAsync],
  );

  return {
    account: address,
    chainId,
    contractAddress: cloakRFP?.address,
    hasContract,
    isConnected,
    isLoadingTender: tenderRead.isFetching,
    isWriting: isWriting || isWaitingForReceipt,
    message,
    readError,
    refreshTender,
    createTender,
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
          }
        : undefined,
  };
};
