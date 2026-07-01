"use client";

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { RainbowKitCustomConnectButton } from "~~/components/helper/RainbowKitCustomConnectButton";
import { CreateTenderForm, VendorBidForm, useCloakRFPWagmi } from "~~/hooks/cloakrfp/useCloakRFPWagmi";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const THEME_STORAGE_KEY = "cloakrfp-theme";

type ThemeMode = "light" | "dark";

type CreateTenderDraft = {
  metadataURI: string;
  priceWeight: string;
  deliveryDaysWeight: string;
  warrantyMonthsWeight: string;
  quantityWeight: string;
};

type VendorBidDraft = {
  price: string;
  deliveryDays: string;
  warrantyMonths: string;
  quantity: string;
};

const UINT32_MAX = 4_294_967_295n;

const initialForm: CreateTenderDraft = {
  metadataURI: "",
  priceWeight: "",
  deliveryDaysWeight: "",
  warrantyMonthsWeight: "",
  quantityWeight: "",
};

const initialBidForm: VendorBidDraft = {
  price: "",
  deliveryDays: "",
  warrantyMonths: "",
  quantity: "",
};

const shortenAddress = (address?: string) => {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
};

const displayAddress = (address?: string, empty = "None") => {
  if (!address || address === ZERO_ADDRESS) return empty;
  return shortenAddress(address);
};

const sameAddress = (first?: string, second?: string) =>
  Boolean(first && second && first.toLowerCase() === second.toLowerCase());

const parseUint32Input = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = BigInt(trimmed);
  if (parsed > UINT32_MAX) return undefined;
  return Number(parsed);
};

const hasBlankCreateField = (form: CreateTenderDraft) =>
  !form.metadataURI.trim() ||
  !form.priceWeight.trim() ||
  !form.deliveryDaysWeight.trim() ||
  !form.warrantyMonthsWeight.trim() ||
  !form.quantityWeight.trim();

const buildCreateTenderForm = (form: CreateTenderDraft): CreateTenderForm | undefined => {
  const priceWeight = parseUint32Input(form.priceWeight);
  const deliveryDaysWeight = parseUint32Input(form.deliveryDaysWeight);
  const warrantyMonthsWeight = parseUint32Input(form.warrantyMonthsWeight);
  const quantityWeight = parseUint32Input(form.quantityWeight);
  if (
    priceWeight === undefined ||
    deliveryDaysWeight === undefined ||
    warrantyMonthsWeight === undefined ||
    quantityWeight === undefined
  ) {
    return undefined;
  }
  return {
    metadataURI: form.metadataURI.trim(),
    priceWeight,
    deliveryDaysWeight,
    warrantyMonthsWeight,
    quantityWeight,
  };
};

const hasBlankBidField = (form: VendorBidDraft) =>
  !form.price.trim() || !form.deliveryDays.trim() || !form.warrantyMonths.trim() || !form.quantity.trim();

const buildVendorBidForm = (form: VendorBidDraft): VendorBidForm | undefined => {
  const price = parseUint32Input(form.price);
  const deliveryDays = parseUint32Input(form.deliveryDays);
  const warrantyMonths = parseUint32Input(form.warrantyMonths);
  const quantity = parseUint32Input(form.quantity);
  if (price === undefined || deliveryDays === undefined || warrantyMonths === undefined || quantity === undefined) {
    return undefined;
  }
  return { price, deliveryDays, warrantyMonths, quantity };
};

export default function Home() {
  const cloakRFP = useCloakRFPWagmi();
  const [form, setForm] = useState<CreateTenderDraft>(initialForm);
  const [bidForm, setBidForm] = useState<VendorBidDraft>(initialBidForm);
  const [copied, setCopied] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [themeLoaded, setThemeLoaded] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") setTheme(stored);
    setThemeLoaded(true);
  }, []);

  useEffect(() => {
    if (!themeLoaded) return;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, themeLoaded]);

  const tenderStatus = useMemo(() => {
    if (!cloakRFP.hasContract) {
      return { label: "Not configured", tone: "status-neutral", description: "Deployment address unavailable" };
    }
    if (cloakRFP.tenderMissing) {
      return {
        label: "Not created",
        tone: "status-neutral",
        description:
          cloakRFP.tenderCount === 0n
            ? "Create the first public tender to start browsing."
            : `${cloakRFP.selectedTenderLabel} is ready to initialize`,
      };
    }
    if (!cloakRFP.tender) {
      return { label: "Loading", tone: "status-info", description: "Reading public tender state" };
    }
    if (cloakRFP.tender.closed) {
      return {
        label: "Tender closed",
        tone: "status-success",
        description: "Final winner locked",
      };
    }
    if (cloakRFP.tender.hasPendingVendor) {
      return {
        label: "Pending comparison",
        tone: "status-warn",
        description: "Encrypted comparison awaits resolution",
      };
    }
    if (cloakRFP.tender.hasPublicBestVendor) {
      return {
        label: "Current best vendor",
        tone: "status-success",
        description: "Encrypted comparison resolved",
      };
    }
    return { label: "Open", tone: "status-info", description: "Public rules are live" };
  }, [
    cloakRFP.hasContract,
    cloakRFP.selectedTenderLabel,
    cloakRFP.tender,
    cloakRFP.tenderCount,
    cloakRFP.tenderMissing,
  ]);

  const createDisabledReason = useMemo(() => {
    if (!cloakRFP.hasContract) return "Contract address missing";
    if (!cloakRFP.isConnected) return "Connect wallet";
    if (hasBlankCreateField(form)) return "Enter tender metadata and weights";
    if (!buildCreateTenderForm(form)) return "Use whole numbers from 0 to 4294967295";
    if (cloakRFP.isWriting) return "Confirming transaction";
    return "";
  }, [cloakRFP.hasContract, cloakRFP.isConnected, cloakRFP.isWriting, form]);

  const closeDisabledReason = useMemo(() => {
    if (!cloakRFP.hasContract) return "Contract address missing";
    if (cloakRFP.tenderMissing) return "Create a tender first";
    if (!cloakRFP.tender) return `Load ${cloakRFP.selectedTenderLabel}`;
    if (cloakRFP.tender.closed) return "Tender closed";
    if (!cloakRFP.isConnected) return "Connect buyer wallet";
    if (!sameAddress(cloakRFP.account, cloakRFP.tender.buyer)) return "Only buyer can finalize";
    if (!cloakRFP.tender.hasPublicBestVendor) return "No current best vendor";
    if (cloakRFP.tender.hasPendingVendor) return "Resolve pending comparison first";
    if (cloakRFP.isClosingTender) return "Finalizing tender";
    if (cloakRFP.isWriting) return "Confirming transaction";
    return "";
  }, [
    cloakRFP.account,
    cloakRFP.hasContract,
    cloakRFP.isClosingTender,
    cloakRFP.isConnected,
    cloakRFP.isWriting,
    cloakRFP.selectedTenderLabel,
    cloakRFP.tender,
    cloakRFP.tenderMissing,
  ]);

  const bidDisabledReason = useMemo(() => {
    if (!cloakRFP.isConnected) return "Connect wallet";
    if (!cloakRFP.hasContract) return "Contract address missing";
    if (cloakRFP.tenderMissing) return "Create a tender first";
    if (!cloakRFP.tender) return `Load ${cloakRFP.selectedTenderLabel}`;
    if (cloakRFP.tender.closed) return "Tender closed";
    if (cloakRFP.tender.hasPendingVendor) return "Resolve pending comparison first";
    if (hasBlankBidField(bidForm)) return "Enter all bid fields";
    if (!buildVendorBidForm(bidForm)) return "Use whole numbers from 0 to 4294967295";
    if (cloakRFP.isWriting) return "Confirming transaction";
    if (cloakRFP.isSubmittingBid) return "Submitting encrypted bid";
    return "";
  }, [
    cloakRFP.hasContract,
    cloakRFP.isConnected,
    cloakRFP.isSubmittingBid,
    cloakRFP.isWriting,
    cloakRFP.selectedTenderLabel,
    cloakRFP.tender,
    cloakRFP.tenderMissing,
    bidForm,
  ]);

  const resolveDisabledReason = useMemo(() => {
    if (!cloakRFP.isConnected) return "Connect wallet";
    if (!cloakRFP.hasContract) return "Contract address missing";
    if (cloakRFP.tenderMissing) return "Create a tender first";
    if (!cloakRFP.tender) return `Load ${cloakRFP.selectedTenderLabel}`;
    if (cloakRFP.tender.closed) return "Tender closed";
    if (!cloakRFP.tender.hasPendingVendor) return "No pending comparison";
    if (cloakRFP.isResolvingPendingBest) return "Resolving comparison";
    if (cloakRFP.isWriting) return "Confirming transaction";
    return "";
  }, [
    cloakRFP.hasContract,
    cloakRFP.isConnected,
    cloakRFP.isResolvingPendingBest,
    cloakRFP.isWriting,
    cloakRFP.selectedTenderLabel,
    cloakRFP.tender,
    cloakRFP.tenderMissing,
  ]);

  const updateWeightField = (key: keyof Omit<CreateTenderDraft, "metadataURI">, value: string) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const updateBidField = (key: keyof VendorBidDraft, value: string) => {
    setBidForm(current => ({ ...current, [key]: value }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createDisabledReason) return;
    const payload = buildCreateTenderForm(form);
    if (!payload) return;
    const createdTenderId = await cloakRFP.createTender(payload);
    if (createdTenderId === undefined) return;
    setForm(initialForm);
  };

  const onBidSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (bidDisabledReason) return;
    const payload = buildVendorBidForm(bidForm);
    if (!payload) return;
    const submitted = await cloakRFP.submitBid(payload);
    if (submitted) setBidForm(initialBidForm);
  };

  const onResolvePendingBest = async () => {
    if (resolveDisabledReason) return;
    await cloakRFP.resolvePendingBest();
  };

  const onCloseTender = async () => {
    if (closeDisabledReason) return;
    await cloakRFP.closeTender();
  };

  const copyContractAddress = async () => {
    if (!cloakRFP.contractAddress) return;
    await navigator.clipboard.writeText(cloakRFP.contractAddress);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main
      className="cloak-experience min-h-screen overflow-hidden bg-[var(--app-bg)] text-[var(--text)]"
      data-mode={theme}
    >
      <ThemeStyles />
      <div className="ambient-mesh" aria-hidden="true" />
      <div className="noise-layer" aria-hidden="true" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <TopNav onToggleTheme={() => setTheme(current => (current === "dark" ? "light" : "dark"))} theme={theme} />
        <Hero
          onCreateClick={() => scrollToSection("create-tender")}
          onDashboardClick={() => scrollToSection("tender-dashboard")}
        />

        <Reveal>
          <ConnectionStrip
            chainId={cloakRFP.chainId}
            contractAddress={cloakRFP.contractAddress}
            copied={copied}
            isConnected={cloakRFP.isConnected}
            onCopy={copyContractAddress}
            walletAddress={cloakRFP.account}
          />
        </Reveal>

        {!cloakRFP.hasContract && (
          <Reveal>
            <Notice
              tone="warn"
              title="Deployment address missing"
              message="CloakRFP has no generated address for this chain. Run the template local deploy flow and regenerate contract files before reading live tender data."
            />
          </Reveal>
        )}

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.22fr_0.78fr]">
          <div className="space-y-8">
            <Reveal>
              <TenderBrowser cloakRFP={cloakRFP} />
            </Reveal>
            <Reveal id="tender-dashboard">
              <TenderDashboard
                cloakRFP={cloakRFP}
                closeDisabledReason={closeDisabledReason}
                onCloseTender={onCloseTender}
                onResolvePendingBest={onResolvePendingBest}
                resolveDisabledReason={resolveDisabledReason}
                tenderStatus={tenderStatus}
              />
            </Reveal>
          </div>
          <div className="space-y-8">
            <Reveal id="create-tender">
              <CreateTenderPanel
                cloakRFP={cloakRFP}
                createDisabledReason={createDisabledReason}
                form={form}
                onMetadataURIChange={value => setForm(current => ({ ...current, metadataURI: value }))}
                onSubmit={onSubmit}
                updateNumber={updateWeightField}
              />
            </Reveal>
            <Reveal id="vendor-bid">
              <VendorBidPanel
                bidDisabledReason={bidDisabledReason}
                cloakRFP={cloakRFP}
                form={bidForm}
                onSubmit={onBidSubmit}
                updateNumber={updateBidField}
              />
            </Reveal>
          </div>
        </div>

        <Reveal>
          <PrivacyStory />
        </Reveal>
      </div>
    </main>
  );
}

function Hero({ onCreateClick, onDashboardClick }: { onCreateClick: () => void; onDashboardClick: () => void }) {
  const badges = ["Local FHEVM", "Encrypted bids", "Public audit trail", "Private vendor terms"];
  return (
    <section className="relative min-h-[620px] overflow-hidden rounded-[36px] border border-[var(--hero-border)] bg-[var(--hero-bg)] p-5 shadow-[var(--hero-shadow)] sm:p-8 lg:p-10">
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-glow" aria-hidden="true" />
      <div className="relative z-10 grid h-full grid-cols-1 gap-8 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="flex min-h-[520px] flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">Confidential procurement layer</span>
            </div>
            <h1 className="mt-8 max-w-4xl text-6xl font-black tracking-[-0.055em] text-[var(--heading)] sm:text-7xl lg:text-8xl">
              CloakRFP
            </h1>
            <p className="mt-5 max-w-3xl text-2xl font-semibold tracking-[-0.025em] text-[var(--accent-gold)] sm:text-3xl">
              Confidential procurement for public blockchains
            </p>
            <p className="mt-6 max-w-2xl text-base leading-8 text-[var(--muted)] sm:text-lg">
              Run supplier tenders where vendors submit encrypted commercial bids and the chain compares offers without
              exposing private terms.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {badges.map((badge, index) => (
                <span className="status-badge" key={badge} style={{ animationDelay: `${index * 130}ms` }}>
                  {badge}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <button className="primary-action" onClick={onCreateClick} type="button">
              Create tender
            </button>
            <button className="secondary-action" onClick={onDashboardClick} type="button">
              View tenders
            </button>
          </div>
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Powered by FHEVM / Local private computation
          </p>
        </div>

        <EncryptionVisual />
      </div>
    </section>
  );
}

function TopNav({ onToggleTheme, theme }: { onToggleTheme: () => void; theme: ThemeMode }) {
  return (
    <nav className="top-nav" aria-label="CloakRFP primary navigation">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          C
        </div>
        <div>
          <p className="brand-name">CloakRFP</p>
          <p className="brand-kicker">Confidential procurement</p>
        </div>
      </div>
      <div className="nav-actions">
        <button
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          className="theme-toggle"
          onClick={onToggleTheme}
          type="button"
        >
          <span className="theme-toggle-track">
            <span className="theme-toggle-thumb" />
          </span>
          {theme === "dark" ? "Dark" : "Light"}
        </button>
        <div className="nav-wallet">
          <RainbowKitCustomConnectButton />
        </div>
      </div>
    </nav>
  );
}

function EncryptionVisual() {
  const flow = ["Buyer publishes rules", "Vendors encrypt bids", "Contract compares", "Winner state updates"];
  return (
    <div className="relative flex min-h-[520px] items-center justify-center">
      <div className="privacy-core">
        <div className="privacy-ring ring-one" />
        <div className="privacy-ring ring-two" />
        <div className="privacy-ring ring-three" />
        <div className="privacy-chip">
          <span className="chip-kicker">FHE scoring</span>
          <span className="chip-title">Private terms in motion</span>
          <span className="chip-subtitle">Only public state leaves the shield</span>
        </div>
      </div>
      <div className="flow-stack">
        {flow.map((item, index) => (
          <div className="flow-node" key={item} style={{ animationDelay: `${index * 170}ms` }}>
            <span className="flow-index">{index + 1}</span>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConnectionStrip({
  chainId,
  contractAddress,
  copied,
  isConnected,
  onCopy,
  walletAddress,
}: {
  chainId: number;
  contractAddress?: string;
  copied: boolean;
  isConnected: boolean;
  onCopy: () => void;
  walletAddress?: string;
}) {
  return (
    <section className="premium-card grid grid-cols-1 gap-px overflow-hidden p-0 md:grid-cols-[1fr_0.72fr_1.1fr]">
      <StatusCell
        detail={isConnected ? "Wallet session active" : "Use the top-right wallet control to connect"}
        label="Wallet"
        value={shortenAddress(walletAddress)}
      />
      <StatusCell detail="Active network" label="Network" value={`Chain ${chainId}`} />
      <StatusCell
        detail={contractAddress ? "Deployment selected by generated config" : "No generated address for this chain"}
        label="CloakRFP contract"
        title={contractAddress}
        value={shortenAddress(contractAddress)}
      >
        <button className="copy-button" disabled={!contractAddress} onClick={onCopy} type="button">
          {copied ? "Copied" : "Copy"}
        </button>
      </StatusCell>
    </section>
  );
}

function StatusCell({
  children,
  detail,
  label,
  title,
  value,
}: {
  children?: ReactNode;
  detail: string;
  label: string;
  title?: string;
  value: string;
}) {
  return (
    <div className="status-cell">
      <div className="min-w-0">
        <p className="micro-label">{label}</p>
        <p className="mt-2 truncate font-mono text-sm font-bold text-[var(--heading)]" title={title ?? value}>
          {value}
        </p>
        <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}

function TenderBrowser({ cloakRFP }: { cloakRFP: ReturnType<typeof useCloakRFPWagmi> }) {
  const hasTenders = cloakRFP.tenderIds.length > 0;

  return (
    <section className="premium-card p-5 sm:p-6 lg:p-7">
      <div className="flex flex-col gap-5 border-b border-[var(--border)] pb-6 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="micro-label">Tender browser</p>
          <h2 className="section-title mt-2">Select tender</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {hasTenders ? "Choose the tender to view, bid on, or resolve." : "Create a tender to start browsing."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:min-w-64">
          <InfoCard label="Total tenders" value={cloakRFP.tenderCount.toString()} />
          <InfoCard label="Selected" value={cloakRFP.selectedTenderLabel} />
        </div>
      </div>

      {hasTenders ? (
        <div className="mt-5 flex flex-wrap gap-3">
          {cloakRFP.tenderIds.map(tenderId => {
            const tenderLabel = `Tender #${tenderId.toString()}`;
            const selected = tenderId === cloakRFP.selectedTenderId;
            return (
              <button
                className={`tender-chip ${selected ? "selected" : ""}`}
                disabled={selected || cloakRFP.isLoadingTender}
                key={tenderId.toString()}
                onClick={() => cloakRFP.selectTender(tenderId)}
                type="button"
              >
                {tenderLabel}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty-state mt-6">
          <div className="empty-visual" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-[var(--heading)]">No tenders yet</h3>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">
              The first created tender will become Tender #0 and will be selected automatically.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function TenderDashboard({
  cloakRFP,
  closeDisabledReason,
  onCloseTender,
  onResolvePendingBest,
  resolveDisabledReason,
  tenderStatus,
}: {
  cloakRFP: ReturnType<typeof useCloakRFPWagmi>;
  closeDisabledReason: string;
  onCloseTender: () => Promise<void>;
  onResolvePendingBest: () => Promise<void>;
  resolveDisabledReason: string;
  tenderStatus: { description: string; label: string; tone: string };
}) {
  const messageTone =
    cloakRFP.message.toLowerCase().includes("failed") || cloakRFP.message.toLowerCase().includes("could not")
      ? "error"
      : "info";
  const onRefresh = async () => {
    await cloakRFP.refreshTender();
  };

  return (
    <section className="premium-card p-5 sm:p-6 lg:p-7">
      <div className="flex flex-col gap-5 border-b border-[var(--border)] pb-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="micro-label">Tender dashboard</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h2 className="section-title">{cloakRFP.selectedTenderLabel}</h2>
            <span className={`lifecycle-pill ${tenderStatus.tone}`}>
              <span className="lifecycle-dot" />
              {tenderStatus.label}
            </span>
          </div>
          <p className="mt-2 text-sm text-[var(--muted)]">{tenderStatus.description}</p>
        </div>
        <button
          className="secondary-action compact"
          disabled={!cloakRFP.hasContract || cloakRFP.isLoadingTender}
          onClick={onRefresh}
          type="button"
        >
          {cloakRFP.isLoadingTender ? "Refreshing state..." : "Refresh state"}
        </button>
      </div>

      {cloakRFP.readError && <Notice message={cloakRFP.readError} title="Read failed" tone="error" />}
      {cloakRFP.message && <InlineMessage message={cloakRFP.message} tone={messageTone} />}
      {cloakRFP.tenderMissing && (
        <TenderEmptyState tenderCount={cloakRFP.tenderCount} tenderLabel={cloakRFP.selectedTenderLabel} />
      )}

      {cloakRFP.tender && (
        <div className="mt-6 space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <InfoCard label="Buyer" title={cloakRFP.tender.buyer} value={displayAddress(cloakRFP.tender.buyer)} />
            <InfoCard
              label="Metadata URI"
              title={cloakRFP.tender.metadataURI}
              value={cloakRFP.tender.metadataURI || "Empty"}
              wide
            />
            <InfoCard
              label={cloakRFP.tender.closed ? "Final winner" : "Best vendor"}
              title={cloakRFP.tender.bestVendor}
              value={displayAddress(cloakRFP.tender.bestVendor)}
            />
            <InfoCard
              label="Pending vendor"
              title={cloakRFP.tender.pendingVendor}
              value={displayAddress(cloakRFP.tender.pendingVendor)}
            />
          </div>

          <BestVendorState tender={cloakRFP.tender} />

          <FinalizeTenderPanel
            cloakRFP={cloakRFP}
            closeDisabledReason={closeDisabledReason}
            onCloseTender={onCloseTender}
          />

          <ResolvePendingPanel
            cloakRFP={cloakRFP}
            onResolvePendingBest={onResolvePendingBest}
            resolveDisabledReason={resolveDisabledReason}
          />

          <div>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="micro-label">Scoring model</p>
                <h3 className="mt-1 text-xl font-bold text-[var(--heading)]">Public weights</h3>
              </div>
              <span className="rounded-full border border-[var(--border)] bg-[var(--panel-soft)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
                Lower encrypted score wins
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <WeightCard label="Price" value={cloakRFP.tender.weights.price} />
              <WeightCard label="Delivery days" value={cloakRFP.tender.weights.deliveryDays} />
              <WeightCard label="Warranty" value={cloakRFP.tender.weights.warrantyMonths} />
              <WeightCard label="Quantity" value={cloakRFP.tender.weights.quantity} />
            </div>
          </div>
        </div>
      )}

      {!cloakRFP.tender && !cloakRFP.tenderMissing && !cloakRFP.readError && (
        <div className="mt-6 rounded-[22px] border border-[var(--border)] bg-[var(--panel-soft)] p-6 text-sm text-[var(--muted)]">
          {cloakRFP.hasContract
            ? `Loading ${cloakRFP.selectedTenderLabel} public data.`
            : "Connect to a chain with a CloakRFP deployment."}
        </div>
      )}
    </section>
  );
}

function ResolvePendingPanel({
  cloakRFP,
  onResolvePendingBest,
  resolveDisabledReason,
}: {
  cloakRFP: ReturnType<typeof useCloakRFPWagmi>;
  onResolvePendingBest: () => Promise<void>;
  resolveDisabledReason: string;
}) {
  const hasPending = Boolean(cloakRFP.tender?.hasPendingVendor);
  const isClosed = Boolean(cloakRFP.tender?.closed);
  const resolveTone = cloakRFP.resolveStatus === "error" ? "error" : "info";
  const title = isClosed ? "Tender closed" : hasPending ? "Pending comparison ready" : "No pending comparison";
  const detail = isClosed
    ? "Pending comparison resolution is disabled after finalization."
    : hasPending
      ? `Public decryption will verify ${cloakRFP.selectedTenderLabel}'s encrypted comparison and update the best vendor state.`
      : `${cloakRFP.selectedTenderLabel} is ready for the next encrypted vendor bid.`;
  const buttonLabel =
    cloakRFP.resolveStatus === "decrypting"
      ? "Decrypting comparison"
      : cloakRFP.resolveStatus === "awaiting-wallet"
        ? "Confirm in wallet"
        : cloakRFP.resolveStatus === "resolving"
          ? "Resolving comparison"
          : resolveDisabledReason || "Resolve pending comparison";

  return (
    <div className={`resolve-panel ${hasPending ? "active" : ""}`}>
      <div className="min-w-0">
        <p className="micro-label">Encrypted comparison</p>
        <h3 className="mt-2 text-xl font-black tracking-[-0.035em] text-[var(--heading)]">{title}</h3>
        <p className="mt-2 text-sm leading-7 text-[var(--muted)]">{detail}</p>
      </div>
      <div className="resolve-action">
        <button
          className="secondary-action compact"
          disabled={Boolean(resolveDisabledReason)}
          onClick={onResolvePendingBest}
          type="button"
        >
          {buttonLabel}
        </button>
        {cloakRFP.resolveMessage && <InlineMessage message={cloakRFP.resolveMessage} tone={resolveTone} />}
      </div>
    </div>
  );
}

function FinalizeTenderPanel({
  cloakRFP,
  closeDisabledReason,
  onCloseTender,
}: {
  cloakRFP: ReturnType<typeof useCloakRFPWagmi>;
  closeDisabledReason: string;
  onCloseTender: () => Promise<void>;
}) {
  const isClosed = Boolean(cloakRFP.tender?.closed);
  const closeTone = !isClosed && cloakRFP.closeStatus === "error" ? "error" : "info";
  const buttonLabel = isClosed
    ? "Tender closed"
    : cloakRFP.closeStatus === "awaiting-wallet"
      ? "Confirm in wallet"
      : cloakRFP.closeStatus === "closing"
        ? "Finalizing tender"
        : closeDisabledReason || "Finalize tender";
  const closeMessage = isClosed ? "Tender finalized and winner locked." : cloakRFP.closeMessage;

  return (
    <div className={`resolve-panel ${isClosed ? "active" : ""}`}>
      <div className="min-w-0">
        <p className="micro-label">Buyer award</p>
        <h3 className="mt-2 text-xl font-black tracking-[-0.035em] text-[var(--heading)]">
          {isClosed ? "Tender closed" : "Finalize winner"}
        </h3>
        <p className="mt-2 text-sm leading-7 text-[var(--muted)]">
          {isClosed
            ? "Final winner is locked. No more encrypted bids can be submitted."
            : "The buyer can close this tender after all pending encrypted comparisons are resolved."}
        </p>
      </div>
      <div className="resolve-action">
        <button
          className="primary-action compact"
          disabled={Boolean(closeDisabledReason)}
          onClick={onCloseTender}
          type="button"
        >
          {buttonLabel}
        </button>
        {closeMessage && <InlineMessage message={closeMessage} tone={closeTone} />}
      </div>
    </div>
  );
}

function TenderEmptyState({ tenderCount, tenderLabel }: { tenderCount: bigint; tenderLabel: string }) {
  const title = tenderCount === 0n ? "No tender has been created" : `${tenderLabel} has not been created`;
  const detail =
    tenderCount === 0n
      ? "Create a public tender before encrypted vendor bid entry opens."
      : "Start with public rules and weights before encrypted vendor bid entry opens.";

  return (
    <div className="empty-state mt-6">
      <div className="empty-visual" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div>
        <h3 className="text-2xl font-bold text-[var(--heading)]">{title}</h3>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--muted)]">{detail}</p>
      </div>
    </div>
  );
}

function CreateTenderPanel({
  cloakRFP,
  createDisabledReason,
  form,
  onMetadataURIChange,
  onSubmit,
  updateNumber,
}: {
  cloakRFP: ReturnType<typeof useCloakRFPWagmi>;
  createDisabledReason: string;
  form: CreateTenderDraft;
  onMetadataURIChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  updateNumber: (key: keyof Omit<CreateTenderDraft, "metadataURI">, value: string) => void;
}) {
  const messageTone = cloakRFP.message.toLowerCase().includes("failed") ? "error" : "info";
  const buttonLabel = cloakRFP.isWriting
    ? "Confirming tender"
    : createDisabledReason || (cloakRFP.tenderCount === 0n ? "Create public tender" : "Create another tender");

  return (
    <form className="premium-card p-5 sm:p-6 lg:p-7" onSubmit={onSubmit}>
      <div className="border-b border-[var(--border)] pb-6">
        <p className="micro-label">Guided workflow</p>
        <h2 className="section-title mt-2">Create tender</h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          Weights are public and auditable. They define how encrypted vendor bid values are scored on-chain.
        </p>
      </div>

      <div className="mt-6 space-y-5">
        <div>
          <label className="field-label" htmlFor="metadataURI">
            Metadata URI
          </label>
          <input
            className="premium-input"
            id="metadataURI"
            onChange={event => onMetadataURIChange(event.target.value)}
            placeholder="ipfs://your-tender-metadata"
            required
            value={form.metadataURI}
          />
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
            Enter a metadata URI for this tender, for example an IPFS URI or external procurement reference.
          </p>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="field-label">Scoring weights</p>
            <span className="text-xs font-medium text-[var(--muted)]">uint32 public inputs</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <NumberInput
              label="Price weight"
              onChange={value => updateNumber("priceWeight", value)}
              placeholder="Enter price weight"
              value={form.priceWeight}
            />
            <NumberInput
              label="Delivery days"
              onChange={value => updateNumber("deliveryDaysWeight", value)}
              placeholder="Enter delivery weight"
              value={form.deliveryDaysWeight}
            />
            <NumberInput
              label="Warranty months"
              onChange={value => updateNumber("warrantyMonthsWeight", value)}
              placeholder="Enter warranty weight"
              value={form.warrantyMonthsWeight}
            />
            <NumberInput
              label="Quantity"
              onChange={value => updateNumber("quantityWeight", value)}
              placeholder="Enter quantity weight"
              value={form.quantityWeight}
            />
          </div>
        </div>

        <button className="primary-action full" disabled={Boolean(createDisabledReason)} type="submit">
          {buttonLabel}
        </button>

        {cloakRFP.message && <InlineMessage message={cloakRFP.message} tone={messageTone} />}
      </div>
    </form>
  );
}

function VendorBidPanel({
  bidDisabledReason,
  cloakRFP,
  form,
  onSubmit,
  updateNumber,
}: {
  bidDisabledReason: string;
  cloakRFP: ReturnType<typeof useCloakRFPWagmi>;
  form: VendorBidDraft;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  updateNumber: (key: keyof VendorBidDraft, value: string) => void;
}) {
  const messageTone = cloakRFP.bidStatus === "error" ? "error" : "info";
  const hasSelectedTender = Boolean(cloakRFP.tender);
  const closedMessage = cloakRFP.tender?.closed ? "This tender is closed. New encrypted bids are disabled." : "";
  const pendingComparisonMessage = cloakRFP.tender?.hasPendingVendor
    ? "A pending encrypted comparison must be resolved before another bid can be submitted."
    : "";
  const submitLabel =
    cloakRFP.bidStatus === "encrypting"
      ? "Encrypting fields"
      : cloakRFP.bidStatus === "awaiting-wallet"
        ? "Confirm in wallet"
        : cloakRFP.bidStatus === "submitting"
          ? "Submitting bid"
          : bidDisabledReason || "Submit encrypted bid";

  return (
    <form className="premium-card p-5 sm:p-6 lg:p-7" onSubmit={onSubmit}>
      <div className="border-b border-[var(--border)] pb-6">
        <p className="micro-label">Vendor workflow</p>
        <h2 className="section-title mt-2">
          {hasSelectedTender ? `Submit bid to ${cloakRFP.selectedTenderLabel}` : "Submit encrypted bid"}
        </h2>
        <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
          {cloakRFP.tender?.closed
            ? "This tender is closed. New encrypted bids are disabled."
            : hasSelectedTender
              ? `Bid values are encrypted as euint32 inputs for ${cloakRFP.selectedTenderLabel}. Only handles and proofs are sent to the contract.`
              : "Create or select a tender before submitting encrypted vendor terms."}
        </p>
      </div>

      <div className="mt-6 space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberInput
            label="Price"
            onChange={value => updateNumber("price", value)}
            placeholder="Enter bid price"
            value={form.price}
          />
          <NumberInput
            label="Delivery days"
            onChange={value => updateNumber("deliveryDays", value)}
            placeholder="Enter delivery days"
            value={form.deliveryDays}
          />
          <NumberInput
            label="Warranty months"
            onChange={value => updateNumber("warrantyMonths", value)}
            placeholder="Enter warranty months"
            value={form.warrantyMonths}
          />
          <NumberInput
            label="Quantity"
            onChange={value => updateNumber("quantity", value)}
            placeholder="Enter quantity"
            value={form.quantity}
          />
        </div>

        <div className="bid-state-grid">
          <BidState
            active={!cloakRFP.isConnected}
            label="Wallet"
            value={cloakRFP.isConnected ? "Connected" : "Disconnected"}
          />
          <BidState
            active={!cloakRFP.hasContract}
            label="Contract"
            value={cloakRFP.hasContract ? "Ready" : "Missing"}
          />
          <BidState
            label={hasSelectedTender ? cloakRFP.selectedTenderLabel : "Tender"}
            active={!cloakRFP.tender}
            value={cloakRFP.tender ? "Loaded" : "Missing"}
          />
        </div>

        <button className="primary-action full" disabled={Boolean(bidDisabledReason)} type="submit">
          {submitLabel}
        </button>

        {closedMessage && <InlineMessage message={closedMessage} tone="info" />}
        {pendingComparisonMessage && !closedMessage && <InlineMessage message={pendingComparisonMessage} tone="info" />}
        {cloakRFP.bidMessage && <InlineMessage message={cloakRFP.bidMessage} tone={messageTone} />}
      </div>
    </form>
  );
}

function BidState({ active, label, value }: { active: boolean; label: string; value: string }) {
  return (
    <div className={`bid-state ${active ? "needs-attention" : ""}`}>
      <span className="micro-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BestVendorState({ tender }: { tender: NonNullable<ReturnType<typeof useCloakRFPWagmi>["tender"]> }) {
  const state = tender.closed
    ? {
        eyebrow: "Award state",
        label: "Final winner",
        detail: "Tender closed",
        action: "No more encrypted bids can be submitted",
        addressLabel: "Final winner",
        address: tender.bestVendor,
        tone: "resolved",
      }
    : tender.hasPendingVendor
      ? {
          eyebrow: "Best vendor state",
          label: "Pending challenger",
          detail: "Encrypted comparison needs resolution",
          action: "Resolve pending comparison to update the best vendor state",
          addressLabel: "Pending vendor",
          address: tender.pendingVendor,
          tone: "pending",
        }
      : tender.hasPublicBestVendor
        ? {
            eyebrow: "Best vendor state",
            label: "Current best vendor",
            detail: "Encrypted comparison resolved",
            action: "Tender is ready for another vendor bid",
            addressLabel: "Current leader",
            address: tender.bestVendor,
            tone: "resolved",
          }
        : {
            eyebrow: "Best vendor state",
            label: "No bids yet",
            detail: "Submit the first encrypted bid",
            action: "Encrypted bid values stay private while public state tracks progress",
            addressLabel: "Current leader",
            address: undefined,
            tone: "empty",
          };

  return (
    <div className={`best-vendor-state ${state.tone}`}>
      <div className="best-vendor-copy">
        <p className="micro-label">{state.eyebrow}</p>
        <h3>{state.label}</h3>
        <p>{state.detail}</p>
      </div>
      <div className="best-vendor-meta">
        <span>{state.addressLabel}</span>
        <strong title={state.address}>{displayAddress(state.address)}</strong>
        <p>{state.action}</p>
      </div>
    </div>
  );
}

function PrivacyStory() {
  return (
    <section className="premium-card privacy-story">
      <div className="privacy-copy">
        <div>
          <p className="micro-label">Privacy boundary</p>
          <h2>What the chain sees vs what stays encrypted</h2>
        </div>
        <p>
          CloakRFP separates procurement transparency from commercial secrecy: rules stay public, bid economics stay
          confidential.
        </p>
      </div>
      <div className="privacy-compact-grid">
        <PrivacyColumn
          items={[
            "Tender rules",
            "Buyer/vendor addresses",
            "Transaction activity",
            "Current best vendor before close",
            "Final winner address after close",
          ]}
          kicker="Visible state"
          title="Public"
          variant="gold"
        />
        <PrivacyColumn
          items={["Price", "Delivery days", "Warranty months", "Quantity", "Encrypted score"]}
          kicker="Encrypted inputs"
          title="Private / encrypted"
          variant="cyan"
        />
      </div>
    </section>
  );
}

function PrivacyColumn({
  items,
  kicker,
  title,
  variant,
}: {
  items: string[];
  kicker: string;
  title: string;
  variant: "cyan" | "gold";
}) {
  return (
    <div className="privacy-column">
      <p className={`micro-label ${variant === "gold" ? "text-[var(--accent-gold)]" : "text-[var(--accent-cyan)]"}`}>
        {kicker}
      </p>
      <h3>{title}</h3>
      <ul>
        {items.map(item => (
          <li className="privacy-item" key={item}>
            <span className={`privacy-marker ${variant}`} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function InfoCard({
  label,
  title,
  value,
  wide = false,
}: {
  label: string;
  title?: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`interactive-card info-card ${wide ? "md:col-span-1" : ""}`}>
      <p className="micro-label">{label}</p>
      <p className="mt-3 truncate font-mono text-sm font-bold text-[var(--heading)]" title={title ?? value}>
        {value}
      </p>
    </div>
  );
}

function WeightCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="interactive-card weight-card">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent-cyan)]">{label}</p>
      <p className="mt-4 font-mono text-4xl font-black tracking-[-0.05em] text-[var(--heading)]">{value}</p>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--track)]">
        <div className="h-full w-2/3 rounded-full bg-[linear-gradient(90deg,var(--accent-cyan),var(--accent-gold))]" />
      </div>
    </div>
  );
}

function NumberInput({
  label,
  onChange,
  placeholder,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        className="premium-input"
        id={id}
        inputMode="numeric"
        onChange={event => onChange(event.target.value)}
        pattern="[0-9]*"
        placeholder={placeholder}
        required
        type="text"
        value={value}
      />
    </div>
  );
}

function Notice({ message, title, tone }: { message: string; title: string; tone: "error" | "warn" }) {
  return (
    <div className={`notice ${tone}`}>
      <p className="font-bold">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}

function InlineMessage({ message, tone }: { message: string; tone: "error" | "info" }) {
  return (
    <div className={`inline-message ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {message}
    </div>
  );
}

function Reveal({ children, id }: { children: ReactNode; id?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div className="reveal-section" id={id} ref={ref}>
      {children}
    </div>
  );
}

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      node.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return ref;
}

function ThemeStyles() {
  return (
    <style jsx global>{`
      .cloak-experience {
        --app-bg: #eef2f6;
        --text: #152235;
        --heading: #06101c;
        --muted: #647285;
        --panel: rgb(255 255 255 / 0.76);
        --panel-strong: rgb(255 255 255 / 0.9);
        --panel-soft: rgb(255 255 255 / 0.48);
        --border: rgb(20 34 52 / 0.12);
        --hero-bg:
          radial-gradient(ellipse at 64% 34%, rgb(66 104 117 / 0.16), transparent 36%),
          radial-gradient(ellipse at 86% 6%, rgb(190 158 93 / 0.16), transparent 32%),
          linear-gradient(135deg, rgb(255 255 255 / 0.96), rgb(230 235 241 / 0.76));
        --hero-border: rgb(20 34 52 / 0.14);
        --hero-shadow: 0 34px 110px rgb(28 43 64 / 0.16);
        --accent-gold: #a9854a;
        --accent-gold-strong: #c9aa70;
        --accent-cyan: #2b7f88;
        --accent-cyan-strong: #3f9ca5;
        --accent-cyan-soft: rgb(43 127 136 / 0.1);
        --accent-gold-soft: rgb(169 133 74 / 0.1);
        --track: rgb(6 16 28 / 0.09);
        --card-shadow: 0 24px 90px rgb(31 44 62 / 0.14);
        --focus-ring: rgb(63 156 165 / 0.38);
      }

      .cloak-experience[data-mode="dark"] {
        --app-bg: #05070d;
        --text: #dce5ef;
        --heading: #f7f8fb;
        --muted: #8997a8;
        --panel: rgb(12 17 27 / 0.72);
        --panel-strong: rgb(15 21 33 / 0.9);
        --panel-soft: rgb(255 255 255 / 0.042);
        --border: rgb(206 219 232 / 0.105);
        --hero-bg:
          radial-gradient(ellipse at 62% 38%, rgb(51 96 107 / 0.18), transparent 38%),
          radial-gradient(ellipse at 80% 3%, rgb(177 139 79 / 0.13), transparent 32%),
          linear-gradient(135deg, rgb(5 7 13 / 0.99), rgb(11 16 32 / 0.92));
        --hero-border: rgb(214 225 235 / 0.12);
        --hero-shadow: 0 34px 130px rgb(0 0 0 / 0.42);
        --accent-gold: #c6a66b;
        --accent-gold-strong: #d8bd82;
        --accent-cyan: #6caeb6;
        --accent-cyan-strong: #8bc4cb;
        --accent-cyan-soft: rgb(108 174 182 / 0.1);
        --accent-gold-soft: rgb(198 166 107 / 0.105);
        --track: rgb(255 255 255 / 0.075);
        --card-shadow: 0 28px 95px rgb(0 0 0 / 0.26);
        --focus-ring: rgb(139 196 203 / 0.34);
      }

      .ambient-mesh {
        position: fixed;
        inset: -18%;
        pointer-events: none;
        background:
          radial-gradient(ellipse at 22% 4%, var(--accent-cyan-soft), transparent 35%),
          radial-gradient(ellipse at 80% 8%, var(--accent-gold-soft), transparent 34%),
          linear-gradient(145deg, transparent 0%, rgb(80 95 128 / 0.055) 48%, transparent 100%);
        filter: blur(24px);
        opacity: 0.72;
        transform: translateZ(0);
        animation: meshDrift 18s ease-in-out infinite alternate;
      }

      .noise-layer {
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: 0.065;
        mix-blend-mode: overlay;
        background-image:
          repeating-radial-gradient(circle at 17% 23%, rgb(255 255 255 / 0.42) 0 0.7px, transparent 0.8px 2.8px),
          repeating-linear-gradient(115deg, rgb(255 255 255 / 0.12) 0 1px, transparent 1px 6px);
      }

      .premium-card {
        border: 1px solid var(--border);
        background: var(--panel);
        box-shadow: var(--card-shadow);
        backdrop-filter: blur(22px) saturate(120%);
        border-radius: 28px;
      }

      .interactive-card {
        border: 1px solid var(--border);
        background: var(--panel-soft);
        border-radius: 22px;
        transition:
          transform 180ms ease,
          border-color 180ms ease,
          box-shadow 180ms ease;
      }

      .interactive-card:hover {
        border-color: color-mix(in srgb, var(--accent-cyan) 30%, transparent);
        box-shadow: 0 20px 54px rgb(0 0 0 / 0.16);
        transform: translateY(-2px);
      }

      .hero-grid {
        position: absolute;
        inset: 0;
        background-image:
          linear-gradient(to right, var(--border) 1px, transparent 1px),
          linear-gradient(to bottom, var(--border) 1px, transparent 1px);
        background-size: 72px 72px;
        mask-image: radial-gradient(circle at 44% 28%, black, transparent 68%);
        opacity: 0.38;
      }

      .hero-glow {
        position: absolute;
        inset: 0;
        background:
          linear-gradient(115deg, transparent 0%, rgb(255 255 255 / 0.055) 38%, transparent 58%),
          radial-gradient(ellipse at 73% 46%, color-mix(in srgb, var(--accent-cyan) 19%, transparent), transparent 35%),
          radial-gradient(ellipse at 78% 48%, rgb(255 255 255 / 0.055), transparent 22%);
        animation: sheen 13s ease-in-out infinite;
        pointer-events: none;
      }

      .eyebrow,
      .micro-label,
      .field-label {
        color: var(--muted);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.15em;
        text-transform: uppercase;
      }

      .section-title {
        color: var(--heading);
        font-size: clamp(1.8rem, 4vw, 2.75rem);
        font-weight: 900;
        letter-spacing: -0.045em;
        line-height: 0.96;
      }

      .top-nav {
        position: sticky;
        top: 1rem;
        z-index: 30;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border: 1px solid var(--border);
        border-radius: 28px;
        background:
          linear-gradient(180deg, rgb(255 255 255 / 0.035), transparent),
          color-mix(in srgb, var(--panel) 86%, transparent);
        box-shadow: 0 20px 60px rgb(0 0 0 / 0.2);
        backdrop-filter: blur(24px) saturate(120%);
        padding: 0.7rem;
      }

      .brand-lockup {
        display: inline-flex;
        min-width: 0;
        align-items: center;
        gap: 0.8rem;
        padding-left: 0.2rem;
      }

      .brand-mark {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2.55rem;
        height: 2.55rem;
        border: 1px solid color-mix(in srgb, var(--accent-gold) 28%, transparent);
        border-radius: 16px;
        background:
          linear-gradient(145deg, color-mix(in srgb, var(--accent-gold) 18%, transparent), transparent),
          var(--panel-soft);
        color: var(--accent-gold-strong);
        font-size: 1rem;
        font-weight: 950;
        box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08);
      }

      .brand-name {
        color: var(--heading);
        font-size: 1rem;
        font-weight: 950;
        letter-spacing: -0.04em;
        line-height: 1;
        margin: 0;
      }

      .brand-kicker {
        margin: 0.28rem 0 0;
        color: var(--muted);
        font-size: 0.66rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .nav-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.65rem;
      }

      .nav-wallet {
        display: flex;
        align-items: center;
        justify-content: flex-end;
      }

      .theme-toggle,
      .copy-button,
      .secondary-action,
      .primary-action {
        min-height: 44px;
      }

      .theme-toggle:focus-visible,
      .copy-button:focus-visible,
      .secondary-action:focus-visible,
      .primary-action:focus-visible,
      .premium-input:focus-visible {
        outline: none;
        box-shadow:
          0 0 0 1px color-mix(in srgb, var(--accent-cyan) 60%, transparent),
          0 0 0 5px var(--focus-ring);
      }

      .theme-toggle {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: color-mix(in srgb, var(--panel-soft) 84%, transparent);
        color: var(--heading);
        padding: 0.45rem 0.8rem;
        font-size: 0.8rem;
        font-weight: 800;
        backdrop-filter: blur(16px);
      }

      .theme-toggle-track {
        width: 2.25rem;
        height: 1.25rem;
        border-radius: 999px;
        background: var(--track);
        padding: 0.16rem;
      }

      .theme-toggle-thumb {
        display: block;
        width: 0.92rem;
        height: 0.92rem;
        border-radius: 999px;
        background: linear-gradient(135deg, var(--accent-gold), var(--accent-gold-strong));
        transform: translateX(0);
        transition: transform 180ms ease;
      }

      .cloak-experience[data-mode="light"] .theme-toggle-thumb {
        transform: translateX(0.95rem);
      }

      .primary-action,
      .secondary-action,
      .copy-button {
        border-radius: 999px;
        font-weight: 900;
        transition:
          transform 180ms ease,
          box-shadow 180ms ease,
          background 180ms ease,
          border-color 180ms ease;
      }

      .primary-action {
        border: 1px solid color-mix(in srgb, var(--accent-gold-strong) 52%, transparent);
        background:
          linear-gradient(180deg, rgb(255 255 255 / 0.16), transparent 48%),
          linear-gradient(135deg, #9d7b45, var(--accent-gold-strong));
        color: #080b12;
        padding: 0.95rem 1.4rem;
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.26),
          0 18px 48px color-mix(in srgb, var(--accent-gold) 17%, transparent);
      }

      .primary-action.full {
        width: 100%;
      }

      .secondary-action,
      .copy-button {
        border: 1px solid color-mix(in srgb, var(--accent-cyan) 26%, transparent);
        background: linear-gradient(180deg, rgb(255 255 255 / 0.04), transparent), var(--accent-cyan-soft);
        color: var(--heading);
        padding: 0.8rem 1.1rem;
      }

      .secondary-action.compact {
        padding: 0.65rem 1rem;
      }

      .primary-action:hover,
      .secondary-action:hover,
      .copy-button:hover {
        transform: translateY(-2px);
        box-shadow:
          inset 0 1px 0 rgb(255 255 255 / 0.16),
          0 20px 54px rgb(0 0 0 / 0.18);
      }

      .primary-action:disabled,
      .secondary-action:disabled,
      .copy-button:disabled {
        cursor: not-allowed;
        opacity: 0.48;
        transform: none;
      }

      .status-badge {
        border: 1px solid color-mix(in srgb, var(--accent-cyan) 18%, transparent);
        border-radius: 999px;
        background: color-mix(in srgb, var(--panel-soft) 70%, var(--accent-cyan-soft));
        color: var(--heading);
        padding: 0.56rem 0.78rem;
        font-size: 0.72rem;
        font-weight: 850;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        animation: badgePulse 3.8s ease-in-out infinite;
      }

      .privacy-core {
        position: relative;
        width: min(78vw, 420px);
        aspect-ratio: 1;
      }

      .privacy-core::before {
        position: absolute;
        inset: 9%;
        content: "";
        border-radius: 999px;
        background: radial-gradient(circle, color-mix(in srgb, var(--accent-cyan) 13%, transparent), transparent 64%);
        filter: blur(16px);
      }

      .privacy-ring {
        position: absolute;
        inset: 0;
        border: 1px solid color-mix(in srgb, var(--accent-cyan) 19%, transparent);
        border-radius: 42% 58% 54% 46%;
        box-shadow: inset 0 0 38px rgb(255 255 255 / 0.018);
        animation: rotateRing 26s linear infinite;
      }

      .ring-two {
        inset: 9%;
        border-color: color-mix(in srgb, var(--accent-gold) 22%, transparent);
        animation-duration: 32s;
        animation-direction: reverse;
      }

      .ring-three {
        inset: 18%;
        border-color: color-mix(in srgb, var(--accent-cyan) 27%, transparent);
        animation-duration: 21s;
      }

      .privacy-chip {
        position: absolute;
        inset: 26%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        border: 1px solid var(--border);
        border-radius: 30px;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.045), transparent), var(--panel-strong);
        padding: 1.35rem;
        box-shadow: var(--card-shadow);
        text-align: center;
      }

      .chip-kicker {
        color: var(--accent-cyan);
        font-size: 0.7rem;
        font-weight: 900;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .chip-title {
        margin-top: 0.75rem;
        color: var(--heading);
        font-size: 1.35rem;
        font-weight: 950;
        letter-spacing: -0.04em;
        line-height: 1;
      }

      .chip-subtitle {
        margin-top: 0.8rem;
        color: var(--muted);
        font-size: 0.8rem;
        line-height: 1.5;
      }

      .flow-stack {
        position: absolute;
        right: 0;
        bottom: 1.5rem;
        left: 0;
        display: grid;
        gap: 0.65rem;
      }

      .flow-node {
        display: flex;
        align-items: center;
        gap: 0.7rem;
        width: min(100%, 330px);
        margin-left: auto;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.035), transparent), var(--panel-strong);
        padding: 0.62rem 0.8rem;
        color: var(--heading);
        font-size: 0.82rem;
        font-weight: 800;
        box-shadow: 0 14px 42px rgb(0 0 0 / 0.16);
        animation: floatNode 6.5s ease-in-out infinite;
      }

      .flow-index {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.55rem;
        height: 1.55rem;
        border-radius: 999px;
        background: color-mix(in srgb, var(--accent-cyan-soft) 82%, var(--panel-soft));
        color: var(--accent-cyan);
        font-size: 0.74rem;
        font-weight: 950;
      }

      .status-cell {
        display: flex;
        min-width: 0;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.028), transparent), var(--panel-soft);
        padding: 1.15rem;
      }

      .lifecycle-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.48rem;
        border: 1px solid color-mix(in srgb, currentColor 42%, transparent);
        border-radius: 999px;
        background:
          linear-gradient(180deg, rgb(255 255 255 / 0.035), transparent),
          color-mix(in srgb, currentColor 8%, transparent);
        padding: 0.44rem 0.76rem;
        font-size: 0.78rem;
        font-weight: 900;
        letter-spacing: 0.025em;
      }

      .lifecycle-dot {
        width: 0.48rem;
        height: 0.48rem;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 10%, transparent);
        animation: dotPulse 2.2s ease-in-out infinite;
      }

      .status-neutral {
        color: var(--muted);
      }

      .status-info {
        color: var(--accent-cyan);
      }

      .status-warn {
        color: var(--accent-gold);
      }

      .status-success {
        color: #2ecb90;
      }

      .tender-chip {
        display: inline-flex;
        min-height: 2.75rem;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--panel-soft);
        padding: 0.72rem 1rem;
        color: var(--heading);
        font-size: 0.82rem;
        font-weight: 900;
        transition:
          transform 180ms ease,
          border-color 180ms ease,
          background 180ms ease,
          box-shadow 180ms ease;
      }

      .tender-chip:hover:not(:disabled),
      .tender-chip:focus-visible {
        border-color: color-mix(in srgb, var(--accent-cyan) 42%, transparent);
        box-shadow: 0 14px 34px rgb(0 0 0 / 0.14);
        transform: translateY(-1px);
        outline: none;
      }

      .tender-chip.selected {
        border-color: color-mix(in srgb, var(--accent-gold) 56%, transparent);
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--accent-gold-soft) 72%, transparent), transparent),
          var(--panel-strong);
        color: var(--heading);
      }

      .tender-chip:disabled {
        cursor: default;
      }

      .info-card,
      .weight-card {
        padding: 1rem;
      }

      .weight-card {
        background:
          linear-gradient(145deg, color-mix(in srgb, var(--accent-cyan-soft) 40%, transparent), transparent 58%),
          var(--panel-soft);
      }

      .empty-state {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 1.25rem;
        align-items: center;
        border: 1px dashed color-mix(in srgb, var(--accent-cyan) 32%, transparent);
        border-radius: 26px;
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--accent-cyan-soft) 68%, transparent), transparent),
          var(--panel-soft);
        padding: 1.4rem;
      }

      .empty-visual {
        display: grid;
        gap: 0.35rem;
        width: 4rem;
      }

      .empty-visual span {
        display: block;
        height: 0.65rem;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan) 8%, transparent));
      }

      .empty-visual span:nth-child(2) {
        width: 75%;
      }

      .empty-visual span:nth-child(3) {
        width: 52%;
      }

      .resolve-panel {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1rem;
        border: 1px solid var(--border);
        border-radius: 22px;
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--panel-soft) 84%, transparent), transparent),
          var(--panel-soft);
        padding: 1rem;
      }

      .resolve-panel.active {
        border-color: color-mix(in srgb, var(--accent-gold) 36%, transparent);
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--accent-gold-soft) 78%, transparent), transparent),
          var(--panel-soft);
      }

      .resolve-action {
        display: grid;
        align-content: start;
        gap: 0.75rem;
      }

      .best-vendor-state {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1rem;
        border: 1px solid var(--border);
        border-radius: 22px;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.026), transparent), var(--panel-soft);
        padding: 1rem;
      }

      .best-vendor-state.resolved {
        border-color: rgb(46 203 144 / 0.32);
        background: linear-gradient(135deg, rgb(46 203 144 / 0.1), transparent 62%), var(--panel-soft);
      }

      .best-vendor-state.pending {
        border-color: color-mix(in srgb, var(--accent-gold) 38%, transparent);
        background:
          linear-gradient(135deg, color-mix(in srgb, var(--accent-gold-soft) 86%, transparent), transparent 62%),
          var(--panel-soft);
      }

      .best-vendor-copy h3 {
        margin: 0.45rem 0 0;
        color: var(--heading);
        font-size: 1.35rem;
        font-weight: 950;
        letter-spacing: -0.035em;
      }

      .best-vendor-copy p:not(.micro-label),
      .best-vendor-meta p {
        margin: 0.45rem 0 0;
        color: var(--muted);
        font-size: 0.86rem;
        line-height: 1.55;
      }

      .best-vendor-meta {
        min-width: 0;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: color-mix(in srgb, var(--panel-strong) 72%, transparent);
        padding: 0.9rem;
      }

      .best-vendor-meta span {
        display: block;
        color: var(--muted);
        font-size: 0.68rem;
        font-weight: 850;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      .best-vendor-meta strong {
        display: block;
        margin-top: 0.45rem;
        overflow: hidden;
        color: var(--heading);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 0.92rem;
        font-weight: 900;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (min-width: 768px) {
        .resolve-panel {
          grid-template-columns: minmax(0, 1fr) minmax(220px, 0.42fr);
          align-items: start;
        }

        .best-vendor-state {
          grid-template-columns: minmax(0, 1fr) minmax(220px, 0.38fr);
          align-items: stretch;
        }
      }

      .bid-state-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.6rem;
      }

      .bid-state {
        min-width: 0;
        border: 1px solid color-mix(in srgb, var(--accent-cyan) 18%, transparent);
        border-radius: 18px;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.024), transparent), var(--panel-soft);
        padding: 0.82rem;
      }

      .bid-state.needs-attention {
        border-color: color-mix(in srgb, var(--accent-gold) 38%, transparent);
        background: var(--accent-gold-soft);
      }

      .bid-state strong {
        display: block;
        margin-top: 0.38rem;
        overflow: hidden;
        color: var(--heading);
        font-size: 0.82rem;
        font-weight: 900;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .premium-input {
        margin-top: 0.55rem;
        width: 100%;
        border: 1px solid var(--border);
        border-radius: 16px;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.026), transparent), var(--panel-soft);
        color: var(--heading);
        outline: none;
        padding: 0.9rem 1rem;
        font-size: 0.92rem;
        transition:
          border-color 160ms ease,
          box-shadow 160ms ease,
          background 160ms ease;
      }

      .premium-input:focus {
        border-color: color-mix(in srgb, var(--accent-cyan) 58%, transparent);
        box-shadow: 0 0 0 4px var(--accent-cyan-soft);
      }

      .premium-input::placeholder {
        color: color-mix(in srgb, var(--muted) 62%, transparent);
      }

      .inline-message,
      .notice {
        border-radius: 18px;
        border: 1px solid var(--border);
        padding: 1rem;
        line-height: 1.6;
      }

      .inline-message.info {
        border-color: color-mix(in srgb, var(--accent-cyan) 18%, transparent);
        background: color-mix(in srgb, var(--accent-cyan-soft) 74%, var(--panel-soft));
        color: var(--heading);
      }

      .inline-message.error,
      .notice.error {
        border-color: rgb(248 113 113 / 0.35);
        background: rgb(248 113 113 / 0.11);
        color: #fecaca;
      }

      .notice.warn {
        border-color: color-mix(in srgb, var(--accent-gold) 42%, transparent);
        background: var(--accent-gold-soft);
        color: var(--heading);
      }

      .privacy-story {
        display: grid;
        gap: 1rem;
        padding: 1.1rem;
      }

      .privacy-copy {
        display: grid;
        gap: 0.8rem;
      }

      .privacy-copy h2 {
        margin: 0.35rem 0 0;
        color: var(--heading);
        font-size: clamp(1.35rem, 2.2vw, 1.8rem);
        font-weight: 950;
        letter-spacing: -0.035em;
        line-height: 1.05;
      }

      .privacy-copy p:not(.micro-label) {
        margin: 0;
        color: var(--muted);
        font-size: 0.88rem;
        line-height: 1.65;
      }

      .privacy-compact-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.8rem;
      }

      .privacy-column {
        border: 1px solid var(--border);
        border-radius: 18px;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.026), transparent), var(--panel-soft);
        padding: 1rem;
      }

      .privacy-column h3 {
        margin: 0.35rem 0 0;
        color: var(--heading);
        font-size: 1.08rem;
        font-weight: 950;
        letter-spacing: -0.02em;
      }

      .privacy-column ul {
        margin-top: 0.85rem;
        display: grid;
        gap: 0.5rem;
      }

      .privacy-item {
        display: flex;
        align-items: center;
        gap: 0.58rem;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: linear-gradient(180deg, rgb(255 255 255 / 0.018), transparent), var(--panel);
        padding: 0.5rem 0.62rem;
        color: var(--heading);
        font-size: 0.82rem;
        font-weight: 750;
        line-height: 1.35;
      }

      .privacy-marker {
        width: 0.46rem;
        height: 0.46rem;
        flex: 0 0 auto;
        border-radius: 999px;
      }

      .privacy-marker.gold {
        background: var(--accent-gold-strong);
      }

      .privacy-marker.cyan {
        background: var(--accent-cyan-strong);
      }

      .reveal-section {
        opacity: 0;
        transform: translateY(22px);
        transition:
          opacity 700ms ease,
          transform 700ms ease;
      }

      .reveal-section.is-visible {
        opacity: 1;
        transform: translateY(0);
      }

      @keyframes meshDrift {
        from {
          transform: translate3d(-1%, -1%, 0) scale(1);
        }
        to {
          transform: translate3d(1.2%, 1.4%, 0) scale(1.03);
        }
      }

      @keyframes sheen {
        0%,
        100% {
          opacity: 0.42;
          transform: translateX(-2%);
        }
        50% {
          opacity: 0.9;
          transform: translateX(2%);
        }
      }

      @keyframes badgePulse {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-2px);
        }
      }

      @keyframes rotateRing {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      @keyframes floatNode {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-7px);
        }
      }

      @keyframes dotPulse {
        0%,
        100% {
          opacity: 0.62;
        }
        50% {
          opacity: 1;
        }
      }

      @media (max-width: 720px) {
        .top-nav {
          position: relative;
          top: auto;
          align-items: stretch;
          border-radius: 24px;
          flex-direction: column;
        }

        .brand-lockup {
          padding: 0.25rem 0.35rem 0;
        }

        .nav-actions {
          justify-content: space-between;
          gap: 0.75rem;
          width: 100%;
        }

        .nav-wallet {
          min-width: 0;
        }

        .empty-state {
          grid-template-columns: 1fr;
        }

        .privacy-story {
          padding: 1rem;
        }

        .flow-stack {
          position: relative;
          bottom: auto;
          margin-top: 1rem;
        }

        .flow-node {
          margin-left: 0;
          width: 100%;
        }
      }

      @media (min-width: 900px) {
        .privacy-story {
          grid-template-columns: minmax(240px, 0.56fr) minmax(0, 1fr);
          align-items: start;
        }

        .privacy-compact-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (prefers-reduced-motion: reduce) {
        *,
        *::before,
        *::after {
          animation-duration: 0.001ms !important;
          animation-iteration-count: 1 !important;
          scroll-behavior: auto !important;
          transition-duration: 0.001ms !important;
        }

        .reveal-section {
          opacity: 1;
          transform: none;
        }
      }
    `}</style>
  );
}
