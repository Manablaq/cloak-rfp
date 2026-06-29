"use client";

import { FormEvent, useState } from "react";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { CreateTenderForm, useCloakRFPWagmi } from "~~/hooks/cloakrfp/useCloakRFPWagmi";

const buttonBase =
  "inline-flex items-center justify-center px-5 py-3 text-sm font-semibold transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white " +
  "disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed";
const primaryButton = `${buttonBase} bg-[#FFD208] text-[#2D2D2D] hover:bg-[#e0b900] focus-visible:ring-[#2D2D2D]`;
const secondaryButton = `${buttonBase} bg-black text-white hover:bg-[#1F1F1F] focus-visible:ring-[#FFD208]`;
const panelClass = "bg-white border border-gray-200 shadow-sm p-6 text-gray-900";
const labelClass = "block text-sm font-medium text-gray-700 mb-1";
const inputClass =
  "w-full border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none " +
  "focus:border-gray-900 focus:ring-1 focus:ring-gray-900";

const initialForm: CreateTenderForm = {
  metadataURI: "ipfs://cloakrfp-tender-0",
  priceWeight: 1,
  deliveryDaysWeight: 5,
  warrantyMonthsWeight: 0,
  quantityWeight: 2,
};

const formatAddress = (address?: string) => {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

export default function Home() {
  const cloakRFP = useCloakRFPWagmi();
  const [form, setForm] = useState<CreateTenderForm>(initialForm);

  const updateNumber = (key: keyof Omit<CreateTenderForm, "metadataURI">, value: string) => {
    const parsed = value === "" ? 0 : Number(value);
    setForm(current => ({
      ...current,
      [key]: Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : current[key],
    }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await cloakRFP.createTender(form);
  };

  return (
    <main className="w-full px-4 py-8 text-gray-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#A38025]">Zama Developer Program</p>
          <h1 className="text-4xl font-bold text-gray-950">CloakRFP</h1>
          <p className="max-w-3xl text-gray-700">
            CloakRFP is a confidential tender app where buyers publish public scoring weights and vendors later submit
            encrypted bid fields. This first frontend step reads public tender data and creates tenders with plain
            public inputs only.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className={panelClass}>
            <div className="text-sm text-gray-500">Wallet</div>
            <div className="mt-2 font-mono text-sm font-semibold">{formatAddress(cloakRFP.account)}</div>
            <div className="mt-4">
              <RainbowKitCustomConnectButton />
            </div>
          </div>
          <div className={panelClass}>
            <div className="text-sm text-gray-500">Network</div>
            <div className="mt-2 font-mono text-sm font-semibold">Chain ID {cloakRFP.chainId}</div>
          </div>
          <div className={panelClass}>
            <div className="text-sm text-gray-500">CloakRFP Contract</div>
            <div className="mt-2 break-all font-mono text-sm font-semibold">
              {cloakRFP.contractAddress ?? "No deployment configured for this chain"}
            </div>
          </div>
        </section>

        {!cloakRFP.hasContract && (
          <section className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            CloakRFP has no generated address for the connected chain. Run the template deployment flow, then regenerate
            frontend contract files before reading live tender data.
          </section>
        )}

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className={panelClass}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-3">
              <div>
                <h2 className="text-xl font-bold text-gray-950">Tender 0</h2>
                <p className="text-sm text-gray-600">Public metadata and scoring weights from `getTender(0)`.</p>
              </div>
              <button className={secondaryButton} disabled={!cloakRFP.hasContract} onClick={cloakRFP.refreshTender}>
                {cloakRFP.isLoadingTender ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {cloakRFP.readError && (
              <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-900">{cloakRFP.readError}</div>
            )}

            {cloakRFP.tenderMissing && (
              <div className="border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                Tender 0 does not exist yet.
              </div>
            )}

            {cloakRFP.tender && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Info label="Buyer" value={cloakRFP.tender.buyer} mono />
                  <Info label="Metadata URI" value={cloakRFP.tender.metadataURI || "Empty"} />
                  <Info
                    label="Best vendor"
                    value={cloakRFP.tender.hasPublicBestVendor ? cloakRFP.tender.bestVendor : "None yet"}
                    mono
                  />
                  <Info label="Pending vendor" value={cloakRFP.tender.pendingVendor} mono />
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Scoring Weights</h3>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Metric label="Price" value={cloakRFP.tender.weights.price} />
                    <Metric label="Delivery Days" value={cloakRFP.tender.weights.deliveryDays} />
                    <Metric label="Warranty Months" value={cloakRFP.tender.weights.warrantyMonths} />
                    <Metric label="Quantity" value={cloakRFP.tender.weights.quantity} />
                  </div>
                </div>
              </div>
            )}

            {!cloakRFP.tender && !cloakRFP.tenderMissing && !cloakRFP.readError && (
              <div className="border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                {cloakRFP.hasContract ? "Loading tender 0..." : "Connect to a chain with a CloakRFP deployment."}
              </div>
            )}
          </div>

          <form className={panelClass} onSubmit={onSubmit}>
            <div className="mb-5 border-b border-gray-200 pb-3">
              <h2 className="text-xl font-bold text-gray-950">Create Tender</h2>
              <p className="text-sm text-gray-600">
                Public setup only. Encrypted bid submission is intentionally omitted.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className={labelClass} htmlFor="metadataURI">
                  Metadata URI
                </label>
                <input
                  id="metadataURI"
                  className={inputClass}
                  value={form.metadataURI}
                  onChange={event => setForm(current => ({ ...current, metadataURI: event.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberInput
                  label="Price weight"
                  value={form.priceWeight}
                  onChange={value => updateNumber("priceWeight", value)}
                />
                <NumberInput
                  label="Delivery days weight"
                  value={form.deliveryDaysWeight}
                  onChange={value => updateNumber("deliveryDaysWeight", value)}
                />
                <NumberInput
                  label="Warranty months weight"
                  value={form.warrantyMonthsWeight}
                  onChange={value => updateNumber("warrantyMonthsWeight", value)}
                />
                <NumberInput
                  label="Quantity weight"
                  value={form.quantityWeight}
                  onChange={value => updateNumber("quantityWeight", value)}
                />
              </div>

              <button
                className={primaryButton}
                disabled={!cloakRFP.hasContract || !cloakRFP.isConnected || cloakRFP.isWriting}
              >
                {cloakRFP.isWriting ? "Creating..." : "Create Tender"}
              </button>

              {cloakRFP.message && (
                <div className="border border-gray-200 bg-gray-50 p-3 text-sm">{cloakRFP.message}</div>
              )}
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 break-all text-sm font-semibold text-gray-950 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-gray-200 bg-gray-50 p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold text-gray-950">{value}</div>
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: string) => void }) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={inputClass}
        min={0}
        max={4294967295}
        type="number"
        value={value}
        onChange={event => onChange(event.target.value)}
      />
    </div>
  );
}
