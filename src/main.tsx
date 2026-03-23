import React from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, PencilLine, Search, SlidersHorizontal, Upload } from "lucide-react";

import "./index.css";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Switch } from "./components/ui/switch";
import {
  applyHeaderFieldEdits,
  buildEditableHeader,
  createDefaultSettings,
  deriveEditedConversionParameters,
  extractEditableFields,
  ensureWaveformInformation,
  type HeaderDraft,
  type ConverterSettings,
  type EditableHeaderField
} from "./lib/headerDraft";
import { convertMeasurement } from "./lib/converter";
import {
  createIsmrmrdReader,
  createIsmrmrdWriter,
  preloadHdf5,
  readIsmrmrdMetaSummary
} from "./lib/ismrmrdHdf5";
import {
  getDefaultMappingSelection,
  getXmlAssets,
  getXslAssets,
  type MappingSelection
} from "./lib/mappings";
import { applyMetaTrajectory, mergeHeaderWithMeta, type MetaMrdDetails } from "./lib/metaMrd";
import { formatBigInt, inspectTwixFile, type TwixInspectionResult, type TwixMeasurementEntry } from "./lib/twix";

function App(): React.JSX.Element {
  const [currentFile, setCurrentFile] = React.useState<File | null>(null);
  const [metaFile, setMetaFile] = React.useState<File | null>(null);
  const [metaDetails, setMetaDetails] = React.useState<MetaMrdDetails | null>(null);
  const [inspection, setInspection] = React.useState<TwixInspectionResult | null>(null);
  const [settings, setSettings] = React.useState<ConverterSettings | null>(null);
  const [xmlChoice, setXmlChoice] = React.useState("auto");
  const [xslChoice, setXslChoice] = React.useState("auto");
  const [selection, setSelection] = React.useState<MappingSelection | null>(null);
  const [headerFields, setHeaderFields] = React.useState<EditableHeaderField[]>([]);
  const [headerDraft, setHeaderDraft] = React.useState<HeaderDraft | null>(null);
  const [logLines, setLogLines] = React.useState<string[]>(["Drop a Siemens Twix .dat file to prepare the conversion."]);
  const [liveStatus, setLiveStatus] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [headerFilter, setHeaderFilter] = React.useState("");
  const logRef = React.useRef<HTMLDivElement | null>(null);
  const settingsTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const settingsPanelRef = React.useRef<HTMLDivElement | null>(null);
  const [settingsPosition, setSettingsPosition] = React.useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0
  });

  const xmlAssets = getXmlAssets();
  const xslAssets = getXslAssets();
  const previewMeasurement = inspection && settings ? getPreviewMeasurement(inspection, settings) : null;
  const deferredHeaderFilter = React.useDeferredValue(headerFilter);

  React.useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logLines, liveStatus]);

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

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (settingsPanelRef.current?.contains(target)) return;
      if (settingsTriggerRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSettingsOpen(false);
    };

    updateSettingsPosition();
    window.addEventListener("resize", updateSettingsPosition);
    window.addEventListener("scroll", updateSettingsPosition, true);
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("resize", updateSettingsPosition);
      window.removeEventListener("scroll", updateSettingsPosition, true);
      window.removeEventListener("mousedown", handlePointerDown);
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

  async function handleFile(file: File): Promise<void> {
    setCurrentFile(file);
    setInspection(null);
    setHeaderFields([]);
    setHeaderDraft(null);
    setSelection(null);
    setIsBusy(true);
    resetLog(`Reading header buffers from ${file.name} ...`);

    try {
      const nextInspection = await inspectTwixFile(file);
      const nextSettings = createDefaultSettings(nextInspection);
      const measurement = getPreviewMeasurement(nextInspection, nextSettings);
      const nextSelection = measurement
        ? getDefaultMappingSelection(nextInspection, measurement, {
            selectedXml: xmlChoice === "auto" ? undefined : xmlChoice,
            selectedXsl: xslChoice === "auto" ? undefined : xslChoice
          })
        : null;

      setInspection(nextInspection);
      setSettings(nextSettings);
      setSelection(nextSelection);
      if (measurement && nextSelection) {
        appendLog("Applying XML map and XSLT to build the ISMRMRD header ...");
        const nextDraft = await buildEditableHeader(nextInspection, measurement, nextSelection, nextSettings);
        const mergedDraft = metaDetails ? applyMetaHeaderToDraft(nextDraft, metaDetails.headerXml) : nextDraft;
        setHeaderDraft(mergedDraft);
        setHeaderFields(mergedDraft.fields);
      } else {
        setHeaderDraft(null);
        setHeaderFields([]);
      }
      void preloadHdf5();
      appendLog(`Header parsed. ${nextInspection.measurements.length} measurement(s) found.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Failed to inspect ${file.name}: ${message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleMetaFile(file: File): Promise<void> {
    setIsBusy(true);
    appendLog(`Reading meta MRD ${file.name} ...`);

    try {
      const summary = await readIsmrmrdMetaSummary(file);
      const details: MetaMrdDetails = { file, ...summary };
      setMetaFile(file);
      setMetaDetails(details);
      appendLog(`Loaded meta MRD with ${summary.acquisitionCount} acquisition(s).`);

      if (inspection && settings) {
        await refreshHeader(inspection, settings, xmlChoice, xslChoice, details);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog(`Failed to read meta MRD: ${message}`);
    } finally {
      setIsBusy(false);
    }
  }

  function clearMetaFile(): void {
    setMetaFile(null);
    setMetaDetails(null);
    appendLog("Cleared meta MRD override.");
    if (inspection && settings) {
      void refreshHeader(inspection, settings, xmlChoice, xslChoice, null);
    }
  }

  async function handleConvert(): Promise<void> {
    if (!currentFile || !inspection || !settings || !headerDraft || headerFields.length === 0) return;
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
      if (metaDetails && targets.length !== 1) {
        throw new Error("Meta MRD override is currently only supported when converting a single measurement");
      }
      let headerXml = applyHeaderFieldEdits(headerDraft.xml, headerFields);
      if (!settings.skipSyncData) {
        headerXml = ensureWaveformInformation(headerXml);
      }
      const parameters = deriveEditedConversionParameters(headerDraft.parameters, headerFields);
      writer = await createIsmrmrdWriter(filename, headerXml);
      metaReader = metaFile ? await createIsmrmrdReader(metaFile) : null;
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
      if (metaReader && metaAcquisitionIndex !== metaDetails?.acquisitionCount) {
        throw new Error(
          `Meta MRD acquisition count mismatch: used ${metaAcquisitionIndex}, meta file contains ${metaDetails?.acquisitionCount ?? 0}`
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

  async function refreshHeader(
    nextInspection: TwixInspectionResult,
    nextSettings: ConverterSettings,
    nextXmlChoice: string,
    nextXslChoice: string,
    nextMetaDetails: MetaMrdDetails | null = metaDetails
  ): Promise<void> {
    try {
      const measurement = getPreviewMeasurement(nextInspection, nextSettings);
      const nextSelection = measurement
        ? getDefaultMappingSelection(nextInspection, measurement, {
            selectedXml: nextXmlChoice === "auto" ? undefined : nextXmlChoice,
            selectedXsl: nextXslChoice === "auto" ? undefined : nextXslChoice
          })
        : null;

      setSelection(nextSelection);
      if (measurement && nextSelection) {
        appendLog("Applying XML map and XSLT to build the ISMRMRD header ...");
        const nextDraft = await buildEditableHeader(nextInspection, measurement, nextSelection, nextSettings);
        const mergedDraft = nextMetaDetails ? applyMetaHeaderToDraft(nextDraft, nextMetaDetails.headerXml) : nextDraft;
        setHeaderDraft(mergedDraft);
        setHeaderFields(mergedDraft.fields);
        appendLog(`Header parsed. ${nextInspection.measurements.length} measurement(s) found.`);
      } else {
        setHeaderDraft(null);
        setHeaderFields([]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setHeaderDraft(null);
      setHeaderFields([]);
      appendLog(`Failed to build ISMRMRD header: ${message}`);
    }
  }

  function updateSettings(patch: Partial<ConverterSettings>): void {
    if (!inspection || !settings) return;
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);
    void refreshHeader(inspection, nextSettings, xmlChoice, xslChoice);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[720px] flex-col gap-2 px-6 py-12">
      <header className="space-y-2 pb-1">
        <h1 className="text-[28px] font-bold tracking-[-0.03em] text-foreground">
          siemens to <span className="text-primary">mrd</span>
        </h1>
        <p className="text-[13px] font-normal text-[#505367]">
          Conversion runs fully on-device. No data is sent to a server.
        </p>
      </header>

      {currentFile && inspection ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-foreground">{currentFile.name}</div>
            </div>
            <label className="shrink-0 cursor-pointer">
              <input
                type="file"
                accept=".dat,application/octet-stream"
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
            <InlineInfo label="Format" value={inspection.format === "vb" ? "VB" : "VD/NX"} />
            <InlineInfo label="Measurements" value={String(inspection.measurements.length)} />
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#505367]">Meta MRD</div>
                <div className="mt-1 text-sm text-[#8b8fa3]">
                  {metaDetails ? metaDetails.file.name : "Override header and trajectories"}
                </div>
                {metaDetails ? (
                  <div className="mt-1 text-[11px] text-[#505367]">{metaDetails.acquisitionCount} acquisition(s)</div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".mrd,.h5,application/x-hdf"
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
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className="cursor-pointer rounded-xl border border-border bg-card px-5 py-12 text-center transition hover:border-[rgba(255,255,255,0.12)]"
        >
          <input
            type="file"
            accept=".dat,application/octet-stream"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <Upload className="mx-auto mb-4 size-5 text-[#505367]" />
          <div className="text-sm text-[#8b8fa3]">Drop a .dat file or click to browse</div>
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
                current.map((entry) => (entry.key === key ? { ...entry, value } : entry))
              );
            }}
          />
        )}
      </section>

      {settingsOpen
        ? createPortal(
            <div className="fixed inset-0 z-40">
              <div className="absolute inset-0 bg-black/26 backdrop-blur-[2px]" />
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
                    <div className="mt-1 text-xs text-muted-foreground">Mapping, measurement selection, and export options.</div>
                  </div>
                  <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setSettingsOpen(false)}>
                    Close
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>XML map</Label>
                    <Select
                      value={xmlChoice}
                      onValueChange={(value) => {
                        setXmlChoice(value);
                        if (inspection && settings) void refreshHeader(inspection, settings, value, xslChoice);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        {xmlAssets.map((asset) => (
                          <SelectItem key={asset.name} value={asset.name}>{asset.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>XSLT stylesheet</Label>
                    <Select
                      value={xslChoice}
                      onValueChange={(value) => {
                        setXslChoice(value);
                        if (inspection && settings) void refreshHeader(inspection, settings, xmlChoice, value);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        {xslAssets.map((asset) => (
                          <SelectItem key={asset.name} value={asset.name}>{asset.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Measurement number</Label>
                    <Input
                      type="number"
                      min={1}
                      value={settings?.measNum ?? 1}
                      onChange={(event) => updateSettings({ measNum: Number(event.target.value) || 1 })}
                      disabled={!settings}
                    />
                  </div>

                  <div className="grid gap-3 pt-1">
                    <ToggleRow
                      label="Extract all measurements"
                      checked={settings?.allMeas ?? false}
                      onCheckedChange={(checked) => updateSettings({ allMeas: checked })}
                    />
                    <ToggleRow
                      label="Skip syncdata"
                      checked={settings?.skipSyncData ?? false}
                      onCheckedChange={(checked) => updateSettings({ skipSyncData: checked })}
                    />
                    <ToggleRow
                      label="Append protocol buffers"
                      checked={settings?.bufferAppend ?? false}
                      onCheckedChange={(checked) => updateSettings({ bufferAppend: checked })}
                    />
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

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
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-input px-3 py-2">
      <Label className="text-sm text-foreground">{props.label}</Label>
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </div>
  );
}

interface HeaderTreeNode {
  id: string;
  name: string;
  label: string;
  xmlPath: string;
  children: HeaderTreeNode[];
  field: EditableHeaderField | null;
}

function HeaderTree(props: {
  fields: EditableHeaderField[];
  filter: string;
  onFieldChange: (key: string, value: string) => void;
}): React.JSX.Element {
  const tree = React.useMemo(() => buildHeaderTree(props.fields, props.filter), [props.fields, props.filter]);
  const forceOpen = props.filter.trim().length > 0;
  return (
    <div className="rounded-lg bg-card">
      <div className="space-y-1">
        {tree.children.map((node) => (
          <HeaderTreeNodeView
            key={node.id}
            node={node}
            depth={0}
            forceOpen={forceOpen}
            onFieldChange={props.onFieldChange}
          />
        ))}
      </div>
    </div>
  );
}

function HeaderTreeNodeView(props: {
  node: HeaderTreeNode;
  depth: number;
  forceOpen: boolean;
  onFieldChange: (key: string, value: string) => void;
}): React.JSX.Element {
  const { node, depth, forceOpen, onFieldChange } = props;
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [draftValue, setDraftValue] = React.useState(node.field?.value ?? "");

  React.useEffect(() => {
    setOpen(forceOpen ? true : false);
  }, [forceOpen]);

  React.useEffect(() => {
    if (!node.field) return;
    setDraftValue(node.field.value);
  }, [node.field?.key, node.field?.value]);

  if (!hasChildren && node.field) {
    const commitEdit = (): void => {
      setIsEditing(false);
      if (draftValue !== node.field!.value) {
        onFieldChange(node.field!.key, draftValue);
      }
    };
    const fieldTextStyle: React.CSSProperties = {
      fontSize: "13px",
      lineHeight: "1.2",
      letterSpacing: "0"
    };

    return (
      <div className="group rounded-md px-2 py-2 hover:bg-muted">
        <div className="grid gap-3 md:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)]">
          <div className="flex min-w-0 items-center" style={{ paddingLeft: `${depth * 20}px` }}>
            <div
              className="flex min-w-0 items-center gap-2 font-medium text-foreground"
              style={fieldTextStyle}
              title={node.field.xmlPath}
            >
              <span className="truncate">{node.field.label}</span>
            </div>
          </div>
          <div>
            {isEditing ? (
              <input
                autoFocus
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                onBlur={commitEdit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitEdit();
                  } else if (event.key === "Escape") {
                    setDraftValue(node.field!.value);
                    setIsEditing(false);
                  }
                }}
                className="block w-full rounded-sm border border-[rgba(255,255,255,0.06)] bg-[#0a0d12] px-2 py-1 font-normal text-foreground outline-none focus:border-[rgba(255,255,255,0.12)]"
                style={fieldTextStyle}
              />
            ) : (
              <button
                type="button"
                className="block w-full rounded-sm px-2 py-1 text-left font-normal text-[#cfd3dd] hover:bg-[rgba(255,255,255,0.03)]"
                style={fieldTextStyle}
                onClick={() => setIsEditing(true)}
                title="Click to edit"
              >
                <span className="truncate">{node.field.value || " "}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md">
      <button
        type="button"
        className="flex h-[30px] w-full items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-muted"
        onClick={() => setOpen((current) => !current)}
      >
        <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 20}px` }}>
          {open ? <ChevronDown className="size-4 text-[#505367]" /> : <ChevronRight className="size-4 text-[#505367]" />}
          <span className="truncate text-[13px] text-foreground">{node.label}</span>
        </div>
        <span className="min-w-6 text-right text-[11px] tabular-nums text-[#505367]">{node.children.length}</span>
      </button>
      {open ? (
        <div className="space-y-1">
          {node.children.map((child) => (
            <HeaderTreeNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              forceOpen={forceOpen}
              onFieldChange={onFieldChange}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function buildHeaderTree(fields: EditableHeaderField[], filter: string): HeaderTreeNode {
  const root: HeaderTreeNode = {
    id: "root",
    name: "root",
    label: "root",
    xmlPath: "",
    children: [],
    field: null
  };

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredFields = normalizedFilter
    ? fields.filter((field) =>
        [field.label, field.xmlPath, field.value, field.source].some((value) =>
          value.toLowerCase().includes(normalizedFilter)
        )
      )
    : fields;

  for (const field of filteredFields) {
    const segments = field.xmlPath.split("/");
    let current = root;

    for (const segment of segments) {
      const parsed = parseXmlPathSegment(segment);
      const nodeId = current.id === "root" ? segment : `${current.id}/${segment}`;
      let child = current.children.find((entry) => entry.id === nodeId);
      if (!child) {
        child = {
          id: nodeId,
          name: parsed.name,
          label: parsed.label,
          xmlPath: current.xmlPath ? `${current.xmlPath}/${segment}` : segment,
          children: [],
          field: null
        };
        current.children.push(child);
      }
      current = child;
    }

    current.field = field;
  }

  sortTree(root);
  return root;
}

function sortTree(node: HeaderTreeNode): void {
  node.children.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
  for (const child of node.children) sortTree(child);
}

function parseXmlPathSegment(segment: string): { name: string; label: string } {
  const match = /^(.+)\[(\d+)\]$/.exec(segment);
  const name = match ? match[1] : segment;
  const index = match ? Number.parseInt(match[2], 10) : 0;
  const pretty = name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return {
    name,
    label: match ? `${pretty} ${index + 1}` : pretty
  };
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

function applyMetaHeaderToDraft(draft: HeaderDraft, metaHeaderXml: string): HeaderDraft {
  const xml = mergeHeaderWithMeta(draft.xml, metaHeaderXml);
  return {
    ...draft,
    xml,
    fields: extractEditableFields(xml)
  };
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


const container = document.querySelector("#app");
if (!container) {
  throw new Error("App root not found");
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
