import React from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { Download, PencilLine, Search, SlidersHorizontal, Upload } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";
import { useRegisterSW } from "virtual:pwa-register/react";

import "./index.css";
import { Button } from "./components/ui/button";
import { HeaderTree, isPathWithinNode } from "./components/header-tree";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import {
  applyHeaderFieldEdits,
  buildEditableHeader,
  buildEditableHeaderFromXml,
  createDefaultSettings,
  deriveEditedConversionParameters,
  extractEditableFields,
  ensureWaveformInformation,
  isFieldDeletable,
  isFieldManuallyEdited,
  mergeHeaderFieldsWithSecondary,
  type HeaderDraft,
  type ConverterSettings,
  type EditableHeaderField
} from "./lib/headerDraft";
import { convertMeasurement } from "./lib/converter";
import {
  createIsmrmrdReader,
  createIsmrmrdWriter,
  mergeIsmrmrdFileWithMeta,
  preloadHdf5,
  readIsmrmrdDatasetSummary,
  rewriteIsmrmrdFile,
  type IsmrmrdDatasetSummary
} from "./lib/ismrmrdHdf5";
import {
  getDefaultMappingSelection,
  getXmlAssets,
  getXslAssets,
  type MappingSelection
} from "./lib/mappings";
import { applyMetaTrajectory, mergeHeaderWithMeta, readSecondaryHeaderFile, type MetaMrdDetails } from "./lib/metaMrd";
import { inspectTwixFile, type TwixInspectionResult, type TwixMeasurementEntry } from "./lib/twix";

type PrimaryInputKind = "twix" | "mrd";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function App(): React.JSX.Element {
  const defaultSettings = React.useMemo<ConverterSettings>(
    () => ({
      measNum: 1,
      allMeas: true,
      skipSyncData: false,
      bufferAppend: false
    }),
    []
  );
  const [currentFile, setCurrentFile] = React.useState<File | null>(null);
  const [primaryInputKind, setPrimaryInputKind] = React.useState<PrimaryInputKind | null>(null);
  const [metaFile, setMetaFile] = React.useState<File | null>(null);
  const [metaDetails, setMetaDetails] = React.useState<MetaMrdDetails | null>(null);
  const [inspection, setInspection] = React.useState<TwixInspectionResult | null>(null);
  const [mrdSummary, setMrdSummary] = React.useState<IsmrmrdDatasetSummary | null>(null);
  const [settings, setSettings] = React.useState<ConverterSettings>(defaultSettings);
  const [xmlChoice, setXmlChoice] = React.useState("auto");
  const [xslChoice, setXslChoice] = React.useState("auto");
  const [selection, setSelection] = React.useState<MappingSelection | null>(null);
  const [headerFields, setHeaderFields] = React.useState<EditableHeaderField[]>([]);
  const [headerDraft, setHeaderDraft] = React.useState<HeaderDraft | null>(null);
  const [logLines, setLogLines] = React.useState<string[]>(["Drop a Siemens Twix .dat or an existing .mrd/.h5 file to begin."]);
  const [liveStatus, setLiveStatus] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [headerFilter, setHeaderFilter] = React.useState("");
  const [installPrompt, setInstallPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const logRef = React.useRef<HTMLDivElement | null>(null);
  const settingsTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const settingsPanelRef = React.useRef<HTMLDivElement | null>(null);
  const twixHeaderRefreshIdRef = React.useRef(0);
  const [settingsPosition, setSettingsPosition] = React.useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0
  });

  const xmlAssets = getXmlAssets();
  const xslAssets = getXslAssets();
  const previewMeasurement = inspection ? getPreviewMeasurement(inspection, settings) : null;
  const deferredHeaderFilter = React.useDeferredValue(headerFilter);
  useRegisterSW();
  const twixSettingsAvailable = primaryInputKind !== "mrd";

  React.useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines, liveStatus]);

  React.useEffect(() => {
    if (primaryInputKind !== "twix" || !inspection) {
      return;
    }
    void refreshTwixHeader(inspection, settings, xmlChoice, xslChoice, metaDetails);
  }, [primaryInputKind, inspection, settings.measNum, settings.allMeas, settings.bufferAppend, xmlChoice, xslChoice, metaDetails]);

  React.useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event): void => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = (): void => {
      setInstallPrompt(null);
      appendLog("App installed.");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  React.useEffect(() => {
    if (!settingsOpen) return;

    const updateSettingsPosition = (): void => {
      const trigger = settingsTriggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const margin = 16;
      const width = Math.min(560, viewportWidth - margin * 2);
      const left = Math.min(
        Math.max(margin, rect.right - width),
        Math.max(margin, viewportWidth - width - margin)
      );

      setSettingsPosition({
        top: rect.bottom + 10,
        left,
        width
      });
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSettingsOpen(false);
    };

    updateSettingsPosition();
    window.addEventListener("resize", updateSettingsPosition);
    window.addEventListener("scroll", updateSettingsPosition, true);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("resize", updateSettingsPosition);
      window.removeEventListener("scroll", updateSettingsPosition, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [settingsOpen]);

  function resetLog(firstLine: string): void {
    setLogLines([firstLine]);
    setLiveStatus("");
  }

  function appendLog(line: string): void {
    setLogLines((current) => [...current, line]);
  }

  async function handleInstallApp(): Promise<void> {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function canReplaceSecondaryMrd(): boolean {
    if (primaryInputKind !== "mrd") {
      return true;
    }
    if (!hasEditedHeader(headerDraft, headerFields)) {
      return true;
    }
    return confirmSecondaryMrdChange();
  }

  function getDroppedFile(event: React.DragEvent<HTMLElement>): File | null {
    const items = Array.from(event.dataTransfer.items ?? []);
    const itemFile = items.find((item) => item.kind === "file")?.getAsFile();
    return itemFile ?? event.dataTransfer.files?.[0] ?? null;
  }

  async function handleFile(file: File): Promise<void> {
    setCurrentFile(file);
    setInspection(null);
    setMrdSummary(null);
    setHeaderFields([]);
    setHeaderDraft(null);
    setSelection(null);
    setIsBusy(true);
    resetLog(`Reading ${isMrdLikeFile(file) ? "MRD" : "header buffers from"} ${file.name} ...`);

    try {
      if (isMrdLikeFile(file)) {
        const summary = await readIsmrmrdDatasetSummary(file);
        const draft = buildMrdHeaderDraft(summary, metaDetails);

        setPrimaryInputKind("mrd");
        setInspection(null);
        setMrdSummary(summary);
        setSettingsOpen(false);
        setSelection(null);
        setHeaderDraft(draft);
        setHeaderFields(draft.fields);
        void preloadHdf5();
        appendLog(formatMrdSummary(summary));
        return;
      }

      const nextInspection = await inspectTwixFile(file);
      const detectedSettings = createDefaultSettings(nextInspection);
      const nextSettings: ConverterSettings = {
        ...settings,
        measNum: settings.allMeas ? detectedSettings.measNum : settings.measNum
      };
      const measurement = getPreviewMeasurement(nextInspection, nextSettings);
      const nextSelection = measurement
        ? getDefaultMappingSelection(nextInspection, measurement, {
            selectedXml: xmlChoice === "auto" ? undefined : xmlChoice,
            selectedXsl: xslChoice === "auto" ? undefined : xslChoice
          })
        : null;

      setPrimaryInputKind("twix");
      setInspection(nextInspection);
      setMrdSummary(null);
      setSettings(nextSettings);
      setSelection(nextSelection);
      setHeaderDraft(null);
      setHeaderFields([]);
      void preloadHdf5();
      appendLog(`Parsed Twix headers. ${nextInspection.measurements.length} measurement(s) found.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Failed to inspect ${file.name}: ${message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleMetaFile(file: File): Promise<void> {
    if (!canReplaceSecondaryMrd()) {
      return;
    }
    setIsBusy(true);
    appendLog(`Reading secondary header file ${file.name} ...`);

    try {
      const details = isXmlHeaderFile(file)
        ? await readSecondaryHeaderFile(file)
        : { file, kind: "mrd" as const, ...(await readIsmrmrdDatasetSummary(file)) };
      setMetaFile(file);
      setMetaDetails(details);
      appendLog(
        details.kind === "xml"
          ? "Loaded secondary XML header."
          : `Loaded secondary MRD with ${details.acquisitionCount} acquisition(s).`
      );

      if (primaryInputKind === "mrd" && mrdSummary) {
        refreshMrdHeader(mrdSummary, details);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Failed to read secondary header file: ${message}`);
    } finally {
      setIsBusy(false);
    }
  }

  function clearMetaFile(): void {
    if (!canReplaceSecondaryMrd()) {
      return;
    }
    setMetaFile(null);
    setMetaDetails(null);
    appendLog("Cleared secondary header file.");
    if (primaryInputKind === "mrd" && mrdSummary) {
      refreshMrdHeader(mrdSummary, null);
    }
  }

  async function handleConvert(): Promise<void> {
    if (!currentFile || !headerDraft || headerFields.length === 0) return;

    if (primaryInputKind === "mrd") {
      await handleMrdConvert(currentFile, headerDraft);
      return;
    }

    if (!inspection || !settings) return;
    setIsBusy(true);
    appendLog("Converting Twix data to ISMRMRD ...");
    setLiveStatus("");
    let writer: Awaited<ReturnType<typeof createIsmrmrdWriter>> | null = null;
    let metaReader: Awaited<ReturnType<typeof createIsmrmrdReader>> | null = null;
    try {
      const outputName = currentFile.name.replace(/\.dat$/i, "") || "converted";
      const filename = `${outputName}.mrd`;
      const saveHandle = await maybePickSaveFileHandle(filename);
      const targets = getTargetMeasurements(inspection, settings);
      if (metaDetails?.kind === "mrd" && targets.length !== 1) {
        throw new Error("Secondary MRD override is currently only supported when converting a single measurement");
      }
      let headerXml = applyHeaderFieldEdits(headerDraft.xml, headerFields);
      if (!settings.skipSyncData) {
        headerXml = ensureWaveformInformation(headerXml);
      }
      const parameters = deriveEditedConversionParameters(headerDraft.parameters, headerFields);
      writer = await createIsmrmrdWriter(filename, headerXml);
      metaReader = metaDetails?.kind === "mrd" && metaFile ? await createIsmrmrdReader(metaFile) : null;
      const activeWriter = writer;
      let lastProgressUpdate = 0;
      let acquisitionCount = 0;
      let lastLoggedAcquisitionCount = 0;
      let lastNonZeroScanCounter = -1;
      let metaAcquisitionIndex = 0;

      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        appendLog(`Measurement ${index + 1}/${targets.length}: ${target.protocolName || "Unnamed measurement"}`);
        await convertMeasurement(currentFile, inspection, target, settings, parameters, {
          onAcquisition: async (acquisition) => {
            acquisitionCount += 1;
            if (acquisition.head.scan_counter > 0) {
              lastNonZeroScanCounter = acquisition.head.scan_counter;
            }
            const nextAcquisition = metaReader
              ? applyMetaTrajectory(acquisition, metaReader.readAcquisition(metaAcquisitionIndex), metaAcquisitionIndex)
              : acquisition;
            if (metaReader) {
              metaAcquisitionIndex += 1;
            }
            await activeWriter.appendAcquisition(nextAcquisition);
          },
          onWaveform: async (waveform) => {
            await activeWriter.appendWaveform(waveform);
          },
          onProgress: ({ bytesProcessed, totalBytes, scanCounter }) => {
            const now = performance.now();
            if (now - lastProgressUpdate < 150) {
              return;
            }
            lastProgressUpdate = now;
            if (scanCounter > 0) {
              lastNonZeroScanCounter = scanCounter;
            }
            const percent = Math.max(0, Math.min(100, (bytesProcessed / totalBytes) * 100));
            const line =
              `Measurement ${index + 1}/${targets.length} · ${percent.toFixed(1)}% · ` +
              `${Math.round(bytesProcessed / (1024 * 1024))}/${Math.round(totalBytes / (1024 * 1024))} MB · ` +
              `acquisitions ${acquisitionCount}` +
              (lastNonZeroScanCounter > 0 ? ` · scan ${lastNonZeroScanCounter}` : "");
            setLiveStatus(line);
            if (acquisitionCount > 0 && acquisitionCount !== lastLoggedAcquisitionCount && acquisitionCount % 25 === 0) {
              lastLoggedAcquisitionCount = acquisitionCount;
              appendLog(`Measurement ${index + 1}/${targets.length}: acquisition ${acquisitionCount}`);
            }
          }
        });
        appendLog(`Measurement ${index + 1}/${targets.length}: complete`);
      }
      if (metaReader && metaDetails?.kind === "mrd" && metaAcquisitionIndex !== metaDetails.acquisitionCount) {
        throw new Error(
          `Secondary MRD acquisition count mismatch: used ${metaAcquisitionIndex}, secondary file contains ${metaDetails.acquisitionCount}`
        );
      }
      setLiveStatus("");

      if (saveHandle) {
        await writer.saveToFileHandle(saveHandle);
        appendLog(`Converted ${targets.length} measurement(s) and saved ${filename}.`);
      } else {
        const blob = await writer.finalizeToBlob();
        triggerDownload(blob, filename);
        appendLog(`Converted ${targets.length} measurement(s) and started the download.`);
      }
    } catch (error) {
      if (isAbortError(error)) {
        writer?.dispose();
        setLiveStatus("");
        appendLog("Save cancelled.");
        return;
      }
      writer?.dispose();
      const message = error instanceof Error ? error.message : String(error);
      setLiveStatus("");
      appendLog(`Failed to write HDF5: ${message}`);
    } finally {
      metaReader?.dispose();
      setIsBusy(false);
    }
  }

  async function handleMrdConvert(currentMrdFile: File, currentHeaderDraft: HeaderDraft): Promise<void> {
    setIsBusy(true);
    appendLog("Rewriting MRD dataset ...");
    setLiveStatus("");

    try {
      const outputName = currentMrdFile.name.replace(/\.(mrd|h5)$/i, "") || "converted";
      const filename = `${outputName}.mrd`;
      const sourceSnapshot = await snapshotFile(currentMrdFile);
      const metaSnapshot = metaFile ? await snapshotFile(metaFile) : null;
      const saveHandle = await maybePickSaveFileHandle(filename);
      const headerXml = applyHeaderFieldEdits(currentHeaderDraft.xml, headerFields);

      if (metaSnapshot && metaDetails?.kind === "mrd") {
        const merged = await mergeIsmrmrdFileWithMeta(sourceSnapshot, metaSnapshot, filename, headerXml, saveHandle);
        if (!saveHandle && merged) {
          triggerDownload(merged, filename);
        }
        appendLog(`Merged MRD header and trajectories into ${filename}.`);
      } else {
        const rewritten = await rewriteIsmrmrdFile(sourceSnapshot, filename, headerXml, saveHandle);
        if (!saveHandle && rewritten) {
          triggerDownload(rewritten, filename);
        }
        appendLog(
          metaDetails?.kind === "xml"
            ? `Merged XML header into ${filename}.`
            : `Updated MRD header and saved ${filename}.`
        );
      }
    } catch (error) {
      if (isAbortError(error)) {
        appendLog("Save cancelled.");
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Failed to rewrite MRD: ${message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function refreshTwixHeader(
    nextInspection: TwixInspectionResult,
    nextSettings: ConverterSettings,
    nextXmlChoice: string,
    nextXslChoice: string,
    nextMetaDetails: MetaMrdDetails | null = metaDetails
  ): Promise<void> {
    const refreshId = twixHeaderRefreshIdRef.current + 1;
    twixHeaderRefreshIdRef.current = refreshId;
    try {
      const measurement = getPreviewMeasurement(nextInspection, nextSettings);
      const nextSelection = measurement
        ? getDefaultMappingSelection(nextInspection, measurement, {
            selectedXml: nextXmlChoice === "auto" ? undefined : nextXmlChoice,
            selectedXsl: nextXslChoice === "auto" ? undefined : nextXslChoice
          })
        : null;

      if (measurement && nextSelection) {
        setSelection(nextSelection);
        appendLog(`Applying XML map ${nextSelection.selectedXml} with XSLT ${nextSelection.selectedXsl} to build the ISMRMRD header ...`);
        const nextDraft = await buildEditableHeader(nextInspection, measurement, nextSelection, nextSettings);
        if (refreshId !== twixHeaderRefreshIdRef.current) {
          return;
        }
        const mergedDraft = nextMetaDetails ? applyMetaHeaderToDraft(nextDraft, nextMetaDetails.headerXml) : nextDraft;
        setHeaderDraft(mergedDraft);
        setHeaderFields(mergedDraft.fields);
        appendLog(`Header parsed. ${nextInspection.measurements.length} measurement(s) found.`);
      } else {
        if (refreshId !== twixHeaderRefreshIdRef.current) {
          return;
        }
        setSelection(nextSelection);
        setHeaderDraft(null);
        setHeaderFields([]);
      }
    } catch (error) {
      if (refreshId !== twixHeaderRefreshIdRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setHeaderDraft(null);
      setHeaderFields([]);
      appendLog(`Failed to build ISMRMRD header: ${message}`);
    }
  }

  function refreshMrdHeader(
    nextSummary: IsmrmrdDatasetSummary,
    nextMetaDetails: MetaMrdDetails | null = metaDetails
  ): void {
    try {
      const draft = buildMrdHeaderDraft(nextSummary, nextMetaDetails);
      setHeaderDraft(draft);
      setHeaderFields(draft.fields);
      appendLog(formatMrdSummary(nextSummary));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHeaderDraft(null);
      setHeaderFields([]);
      appendLog(`Failed to build MRD header: ${message}`);
    }
  }

  function updateSettings(patch: Partial<ConverterSettings>): void {
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[720px] flex-col gap-2 px-6 py-12">
      <header className="space-y-2 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-foreground">
            siemens to <span className="text-primary">mrd</span>
          </h1>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-md border border-border text-[#8b8fa3] disabled:cursor-default disabled:opacity-45"
            title={
              installPrompt
                ? "Install app. After the first online load, it can work offline."
                : "Install app. Available on supported browsers after the app becomes installable."
            }
            aria-label="Install app"
            disabled={!installPrompt}
            onClick={() => void handleInstallApp()}
          >
            <Download className="size-4" />
          </Button>
        </div>
        <p className="text-[13px] font-normal text-[#505367]">
          Converts Siemens raw data to ISMRMRD, edit header, or merge data and meta information.
          <br />
          Everything runs in your browser. No data is sent anywhere!
        </p>
      </header>

      {currentFile && (inspection || mrdSummary) ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <div
            className="rounded-lg transition hover:border-[rgba(255,255,255,0.12)]"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const file = getDroppedFile(event);
              if (file) void handleFile(file);
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold text-foreground" title={currentFile.name}>
                  {currentFile.name}
                </div>
              </div>
              <label className="shrink-0 cursor-pointer">
                <input
                  type="file"
                  accept=".dat,.mrd,.h5,application/octet-stream,application/x-hdf"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
                <span className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] text-[#8b8fa3]">
                  Change file
                </span>
              </label>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-4">
              <InlineInfo label="Size" value={formatFileSize(currentFile.size)} />
              <InlineInfo
                label="Format"
                value={primaryInputKind === "mrd" ? "MRD/HDF5" : inspection?.format === "vb" ? "VB" : "VD/NX"}
              />
              <InlineInfo
                label={primaryInputKind === "mrd" ? "Acquisitions" : "Measurements"}
                value={
                  primaryInputKind === "mrd" ? String(mrdSummary?.acquisitionCount ?? 0) : String(inspection?.measurements.length ?? 0)
                }
              />
            </div>
          </div>

          <div
            className="mt-4 border-t border-border pt-4"
            onDragOverCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDropCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const file = getDroppedFile(event);
              if (file && !isXmlHeaderFile(file) && !isMrdLikeFile(file)) {
                appendLog(`Failed to read secondary header file: unsupported file type "${file.name}"`);
                return;
              }
              if (file) void handleMetaFile(file);
            }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#505367]">Secondary Header</div>
                <div className="mt-1 truncate text-sm text-[#8b8fa3]" title={metaDetails?.file.name}>
                  {metaDetails
                    ? metaDetails.file.name
                    : "Use an MRD or XML file to replace header information or trajectories."}
                </div>
                {metaDetails ? (
                  <div className="mt-1 text-[11px] text-[#505367]">
                    {metaDetails.kind === "xml" ? "Header only" : `${metaDetails.acquisitionCount} acquisition(s)`}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".mrd,.h5,.xml,application/x-hdf,application/xml,text/xml"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void handleMetaFile(file);
                    }}
                  />
                  <span className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] text-[#8b8fa3]">
                    {metaDetails ? "Replace" : "Add"}
                  </span>
                </label>
                {metaDetails ? (
                  <Button variant="ghost" size="sm" className="h-8 px-3 text-[12px]" onClick={clearMetaFile}>
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const file = getDroppedFile(event);
            if (file) void handleFile(file);
          }}
          className="cursor-pointer rounded-xl border border-border bg-card px-5 py-12 text-center transition hover:border-[rgba(255,255,255,0.12)]"
        >
          <input
            type="file"
            accept=".dat,.mrd,.h5,application/octet-stream,application/x-hdf"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Upload className="mx-auto mb-4 size-5 text-[#505367]" />
          <div className="text-sm text-[#8b8fa3]">Drop a .dat, .mrd, or .h5 file or click to browse</div>
        </label>
      )}

      <section className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-muted p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-semibold text-foreground">Conversion</div>
          </div>
          <Button
            ref={settingsTriggerRef}
            variant="ghost"
            size="icon"
            className="size-8 rounded-md text-[#505367]"
            aria-label="Toggle settings"
            aria-expanded={settingsOpen}
            title="Settings"
            onClick={() => setSettingsOpen((current) => !current)}
          >
            <SlidersHorizontal className="size-4" />
          </Button>
        </div>

        <div
          ref={logRef}
          className="log-panel mt-4 max-h-40 overflow-y-auto rounded-lg border border-[rgba(255,255,255,0.04)] bg-[#0a0d12] px-4 py-3 font-mono text-[12px] leading-[1.7] text-muted-foreground"
        >
          <div className="space-y-1">
            {logLines.map((line, index) => (
              <div key={`${index}-${line}`}>{line}</div>
            ))}
            {liveStatus ? <div className="text-foreground">{liveStatus}</div> : null}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end border-t border-[rgba(255,255,255,0.03)] pt-4">
          <Button
            className="min-w-[140px] px-8"
            onClick={() => void handleConvert()}
            disabled={isBusy || headerFields.length === 0}
          >
            Convert
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <span>Header</span>
          <PencilLine className="size-4 text-[#505367]" />
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#505367]" />
          <Input
            value={headerFilter}
            onChange={(event) => setHeaderFilter(event.target.value)}
            placeholder="Filter header fields..."
            className="pl-9"
          />
        </div>
        {headerFields.length === 0 ? (
          <div className="rounded-lg bg-input px-4 py-10 text-center text-sm text-muted-foreground">
            Open a file to populate the header tree.
          </div>
        ) : (
          <HeaderTree
            fields={headerFields}
            filter={deferredHeaderFilter}
            onFieldChange={(key, value) => {
              setHeaderFields((current) =>
                current.map((entry) => (entry.key === key ? { ...entry, value, isRemoved: false } : entry))
              );
            }}
            onFieldRestore={(key) => {
              setHeaderFields((current) =>
                current.map((entry) =>
                  entry.key === key && entry.primaryValue !== null
                    ? { ...entry, value: entry.primaryValue, isRemoved: false }
                    : entry
                )
              );
            }}
            onToggleFieldRemoved={(key, removed) => {
              setHeaderFields((current) =>
                current.map((entry) =>
                  entry.key === key && isFieldDeletable(entry)
                    ? { ...entry, isRemoved: removed }
                    : entry
                )
              );
            }}
            onToggleNodeRemoved={(xmlPath, removed) => {
              setHeaderFields((current) =>
                current.map((entry) =>
                  isFieldDeletable(entry) && isPathWithinNode(entry.xmlPath, xmlPath)
                    ? { ...entry, isRemoved: removed }
                    : entry
                )
              );
            }}
          />
        )}
      </section>

      {settingsOpen
        ? createPortal(
            <div className="fixed inset-0 z-40">
              <div
                className="absolute inset-0 bg-black/26 backdrop-blur-[2px]"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    setSettingsOpen(false);
                  }
                }}
              />
              <div
                ref={settingsPanelRef}
                className="absolute rounded-xl border border-border bg-card p-5"
                style={{
                  top: `${settingsPosition.top}px`,
                  left: `${settingsPosition.left}px`,
                  width: `${settingsPosition.width}px`
                }}
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-foreground">Settings</div>
                  </div>
                  <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setSettingsOpen(false)}>
                    Close
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>XML map</Label>
                    <Select value={xmlChoice} onValueChange={setXmlChoice}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        {xmlAssets.map((asset) => (
                          <SelectItem key={asset.name} value={asset.name}>{formatMappingAssetLabel(asset.name)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>XSLT stylesheet</Label>
                    <Select value={xslChoice} onValueChange={setXslChoice}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        {xslAssets.map((asset) => (
                          <SelectItem key={asset.name} value={asset.name}>{formatMappingAssetLabel(asset.name)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Measurement number</Label>
                    <Input
                      type="number"
                      min={1}
                      value={settings.measNum}
                      onChange={(event) => updateSettings({ measNum: Number(event.target.value) || 1 })}
                      disabled={!twixSettingsAvailable || settings.allMeas}
                    />
                  </div>

                  <div className="grid gap-3 pt-1">
                    <ToggleRow
                      label="Extract all measurements"
                      checked={settings.allMeas}
                      onCheckedChange={(checked) => updateSettings({ allMeas: checked })}
                      disabled={!twixSettingsAvailable}
                    />
                    <ToggleRow
                      label="Skip syncdata"
                      checked={settings.skipSyncData}
                      onCheckedChange={(checked) => updateSettings({ skipSyncData: checked })}
                      disabled={primaryInputKind === "mrd"}
                    />
                    <ToggleRow
                      label="Append protocol buffers"
                      checked={settings.bufferAppend}
                      onCheckedChange={(checked) => updateSettings({ bufferAppend: checked })}
                      disabled={primaryInputKind === "mrd"}
                    />
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      <footer className="pt-4 text-[11px] leading-5 text-[#505367]">
        <p className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-center">
          <a
            href="https://github.com/fzimmermann89/siemens2mrd"
            target="_blank"
            rel="noreferrer"
            className="inline-flex size-6 items-center justify-center rounded-md border border-border text-[#8b8fa3] transition-colors hover:text-foreground"
            aria-label="Open GitHub repository"
            title="View source on GitHub"
          >
            <GitHubMark className="size-3.5" />
          </a>
          <span>built by</span>
          <a
            href="https://github.com/fzimmermann89"
            target="_blank"
            rel="noreferrer"
            className="text-[#8b8fa3] transition-colors hover:text-foreground"
          >
            Felix F. Zimmermann.
          </a>
          <span>powered by</span>
          <a
            href="https://github.com/ismrmrd/ismrmrd"
            target="_blank"
            rel="noreferrer"
            className="text-[#8b8fa3] transition-colors hover:text-foreground"
          >
            ismrmrd
          </a>
          <span>via</span>
          <a
            href="https://emscripten.org/"
            target="_blank"
            rel="noreferrer"
            className="text-[#8b8fa3] transition-colors hover:text-foreground"
          >
            emscripten.
          </a>
          <span>{`v${__APP_VERSION__}.`}</span>
          <a
            href="/THIRD_PARTY_NOTICES.md"
            target="_blank"
            rel="noreferrer"
            className="text-[#8b8fa3] transition-colors hover:text-foreground"
          >
            Notices
          </a>
        </p>
      </footer>

    </main>
  );
}

function InlineInfo(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#505367]">{props.label}</p>
      <p className="mt-1 text-[15px] font-medium text-foreground">{props.value}</p>
    </div>
  );
}

function ToggleRow(props: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-input px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
      disabled={props.disabled}
      onClick={() => props.onCheckedChange(!props.checked)}
    >
      <span className="text-sm font-medium text-foreground">{props.label}</span>
      <Switch checked={props.checked} className="pointer-events-none" aria-hidden="true" />
    </button>
  );
}

function GitHubMark(props: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      className={props.className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8a8.01 8.01 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.6 7.6 0 0 1 8 4.84c.68 0 1.37.09 2.01.27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function getPreviewMeasurement(inspection: TwixInspectionResult, settings: ConverterSettings): TwixMeasurementEntry | null {
  if (inspection.measurements.length === 0) return null;
  if (settings.allMeas) return inspection.measurements[0] ?? null;

  const requested = settings.measNum;
  const index = requested < 0 ? inspection.measurements.length + requested : requested - 1;
  return inspection.measurements[Math.max(0, Math.min(index, inspection.measurements.length - 1))] ?? null;
}

function getTargetMeasurements(inspection: TwixInspectionResult, settings: ConverterSettings): TwixMeasurementEntry[] {
  if (settings.allMeas) return inspection.measurements;
  const preview = getPreviewMeasurement(inspection, settings);
  return preview ? [preview] : [];
}

function formatMappingAssetLabel(name: string): string {
  return name.replace(/^IsmrmrdParameterMap_/, "");
}

function applyMetaHeaderToDraft(draft: HeaderDraft, metaHeaderXml: string): HeaderDraft {
  const xml = mergeHeaderWithMeta(draft.xml, metaHeaderXml);
  const mergedFields = extractEditableFields(xml);
  const secondaryFields = extractEditableFields(metaHeaderXml);
  return {
    ...draft,
    xml,
    fields: mergeHeaderFieldsWithSecondary(draft.fields, mergedFields, secondaryFields)
  };
}

function buildMrdHeaderDraft(summary: IsmrmrdDatasetSummary, metaDetails: MetaMrdDetails | null): HeaderDraft {
  const draft = buildEditableHeaderFromXml(summary.headerXml);
  if (!metaDetails) {
    return draft;
  }
  return applyMetaHeaderToDraft(draft, metaDetails.headerXml);
}

function formatMrdSummary(summary: IsmrmrdDatasetSummary): string {
  return `Loaded MRD with ${summary.acquisitionCount} acquisition(s) and ${summary.waveformCount} waveform(s).`;
}

function hasEditedHeader(headerDraft: HeaderDraft | null, headerFields: EditableHeaderField[]): boolean {
  if (!headerDraft || headerFields.length === 0) {
    return false;
  }
  return headerFields.some((field) => field.isRemoved || isFieldManuallyEdited(field));
}

function confirmSecondaryMrdChange(): boolean {
  return window.confirm(
    "Changing the secondary MRD will rebuild the header and discard unsaved header edits. Continue?"
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function snapshotFile(file: File): Promise<File> {
  const bytes = await file.arrayBuffer();
  return new File([bytes], file.name, {
    type: file.type,
    lastModified: file.lastModified
  });
}

type SaveFileHandle = {
  createWritable: () => Promise<{
    write: (data: BufferSource | Blob) => Promise<void>;
    close: () => Promise<void>;
    abort?: (reason?: unknown) => Promise<void>;
  }>;
};

async function maybePickSaveFileHandle(filename: string): Promise<SaveFileHandle | null> {
  const picker = (window as Window & { showSaveFilePicker?: (options?: unknown) => Promise<SaveFileHandle> }).showSaveFilePicker;
  if (!picker) return null;

  return picker({
    suggestedName: filename,
    types: [
      {
        description: "ISMRMRD files",
        accept: { "application/x-hdf": [".mrd"] }
      }
    ]
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatFileSize(size: number): string {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isMrdLikeFile(file: File): boolean {
  return /\.(mrd|h5)$/i.test(file.name) || file.type === "application/x-hdf";
}

function isXmlHeaderFile(file: File): boolean {
  return /\.xml$/i.test(file.name) || file.type === "application/xml" || file.type === "text/xml";
}


const container = document.querySelector("#app");
if (!container) {
  throw new Error("App root not found");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
    <Analytics />
  </React.StrictMode>
);
