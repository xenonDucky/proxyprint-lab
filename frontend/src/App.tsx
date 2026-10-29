import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Activity } from 'lucide-react';
import {
  DPI_BENCHMARKS,
  optimizePrintAdjustments,
  AdjustmentParams
} from './colorScience';
import { createZipArchive, dataUrlToUint8Array, ZipEntryInput } from './zipBuilder';
import { CARD_STANDARDS, PRINTER_PROFILES, BUILTIN_PRESETS } from './constants';
import { clampByte, applyUserAdjustments, simulatePrinterOutput } from './simulation';
import { generatePresetCardCanvas } from './cardGenerator';
import { runFullPrintPipeline } from './printPipeline';
import { renderCardToPrintReadyCanvas, generateBatchThumbnails } from './renderExport';
import { renderPreviewCanvases } from './canvasRenderer';
import { StudioMode, ViewMode, BatchCardItem, InputMode } from './types';

// Component imports
import { StudioHeader } from './components/StudioHeader';
import { CardSourceSection } from './components/CardSourceSection';
import { PrintTargetSection } from './components/PrintTargetSection';
import { SoftProofViewer } from './components/SoftProofViewer';
import { LiveSimulator } from './components/LiveSimulator';
import { DiagnosticScorecard } from './components/DiagnosticScorecard';
import { BatchStudio } from './components/BatchStudio';

// Re-export for backward compatibility with existing tests and modules
export {
  CARD_STANDARDS,
  PRINTER_PROFILES,
  clampByte,
  applyUserAdjustments,
  simulatePrinterOutput,
  generatePresetCardCanvas,
  runFullPrintPipeline,
  renderCardToPrintReadyCanvas,
  generateBatchThumbnails
};

export default function App() {
  const [studioMode, setStudioMode] = useState<StudioMode>('single');
  const [activePresetId, setActivePresetId] = useState<string | null>('abyssal_dragon');
  const [customFileName, setCustomFileName] = useState<string | null>(null);
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);

  // Batch Queue State
  const [batchItems, setBatchItems] = useState<BatchCardItem[]>([]);
  const [editingBatchItemId, setEditingBatchItemId] = useState<string | null>(null);
  const [batchSaveFlash, setBatchSaveFlash] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const batchFileInputRef = useRef<HTMLInputElement | null>(null);

  const [inputMode, setInputMode] = useState<InputMode | string>('full_card');
  const [cardStandardId, setCardStandardId] = useState('mpc_bleed');
  const [printerProfileId, setPrinterProfileId] = useState('mpc_commercial');

  const [adjustments, setAdjustments] = useState<AdjustmentParams>({
    shadowLift: 0,
    gamma: 1.0,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    sharpen: 0,
    textBoxSharpen: 0,
    artTargetDpi: DPI_BENCHMARKS.min,
    textTargetDpi: DPI_BENCHMARKS.min
  });
  const [padMpcBleed, setPadMpcBleed] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>('three_way');
  const [showGeometryGuides, setShowGeometryGuides] = useState(true);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'local'>('checking');

  const mainPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const origCompareCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const simCompareCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapCompareCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cardStandard = CARD_STANDARDS[cardStandardId] || CARD_STANDARDS.mpc_bleed;
  const printerProfile = PRINTER_PROFILES[printerProfileId] || PRINTER_PROFILES.mpc_commercial;

  // Probe FastAPI Backend availability on mount
  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (data?.status === 'ok') setBackendStatus('connected');
        else setBackendStatus('local');
      })
      .catch(() => setBackendStatus('local'));
  }, []);

  // Load built-in preset whenever activePresetId changes
  useEffect(() => {
    if (!activePresetId) return;
    const generated = generatePresetCardCanvas(activePresetId);
    setSourceCanvas(generated);
    setCustomFileName(null);
    setEditingBatchItemId(null);
    setAdjustments({
      shadowLift: 0,
      gamma: 1.0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: 0,
      textBoxSharpen: 0,
      artTargetDpi: DPI_BENCHMARKS.min,
      textTargetDpi: DPI_BENCHMARKS.min
    });
    setPadMpcBleed(false);
  }, [activePresetId]);

  const handleImageUpload = useCallback((file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        setActivePresetId(null);
        setCustomFileName(file.name);
        setEditingBatchItemId(null);
        setSourceCanvas(c);
        setAdjustments({
          shadowLift: 0,
          gamma: 1.0,
          brightness: 0,
          contrast: 0,
          saturation: 0,
          sharpen: 0,
          textBoxSharpen: 0,
          artTargetDpi: DPI_BENCHMARKS.min,
          textTargetDpi: DPI_BENCHMARKS.min
        });
        setPadMpcBleed(false);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // Run the 6-Stage Pixel Analysis Engine + 3D LUT generator
  const analysis = useMemo(() => {
    if (!sourceCanvas) return null;
    return runFullPrintPipeline({
      sourceCanvas,
      inputMode,
      cardStandard,
      printerProfile,
      adjustments,
      padMpcBleed
    });
  }, [sourceCanvas, inputMode, cardStandard, printerProfile, adjustments, padMpcBleed]);

  // Render visual inspection canvases at 60 FPS using the 3D LUT
  useEffect(() => {
    renderPreviewCanvases({
      sourceCanvas,
      analysis,
      viewMode,
      showGeometryGuides,
      adjustments,
      printerProfile,
      padMpcBleed,
      inputMode,
      mainPreviewCanvas: mainPreviewCanvasRef.current,
      origCompareCanvas: origCompareCanvasRef.current,
      simCompareCanvas: simCompareCanvasRef.current,
      heatmapCompareCanvas: heatmapCompareCanvasRef.current
    });
  }, [
    sourceCanvas,
    analysis,
    viewMode,
    showGeometryGuides,
    adjustments,
    printerProfile,
    padMpcBleed,
    inputMode
  ]);

  const handleAutoOptimize = () => {
    if (!analysis) return;

    const nextPadBleed = cardStandard.requiresBleed && !analysis.geometry.has3mmBleed ? true : padMpcBleed;
    if (nextPadBleed !== padMpcBleed) {
      setPadMpcBleed(nextPadBleed);
    }

    const optimalParams = optimizePrintAdjustments({
      rawPixels: analysis.rawAnalysisPixels,
      anW: analysis.anW,
      anH: analysis.anH,
      has3mmBleed: analysis.geometry.has3mmBleed || nextPadBleed,
      inputMode,
      printerProfile,
      printer3DLut: analysis.printer3DLut,
      resolutionScore: analysis.resolutionScore,
      artOpticalPpi: analysis.geometry.effectiveOpticalPpi,
      textOpticalPpi: analysis.geometry.textOpticalPpi,
      applyUserAdjustmentsFn: applyUserAdjustments
    });

    setAdjustments(optimalParams);
  };

  const handleExportPng = () => {
    if (!sourceCanvas || !analysis) return;
    const outCanvas = renderCardToPrintReadyCanvas(
      sourceCanvas,
      padMpcBleed,
      analysis.geometry.has3mmBleed,
      inputMode,
      adjustments
    );

    const link = document.createElement('a');
    const baseName = customFileName
      ? customFileName.replace(/\.[^/.]+$/, '')
      : activePresetId || 'mtg_proxy';
    link.download = `${baseName}_print_ready_${outCanvas.width}x${outCanvas.height}.png`;
    link.href = outCanvas.toDataURL('image/png');
    link.click();
  };

  // Process a single canvas into an auto-optimized BatchCardItem
  const buildOptimizedBatchItem = useCallback(
    (c: HTMLCanvasElement, fileName: string, id: string): BatchCardItem => {
      const initialAnalysis = runFullPrintPipeline({
        sourceCanvas: c,
        inputMode,
        cardStandard,
        printerProfile,
        adjustments: {
          shadowLift: 0,
          gamma: 1.0,
          brightness: 0,
          contrast: 0,
          saturation: 0,
          sharpen: 0,
          textBoxSharpen: 0
        },
        padMpcBleed: false
      })!;

      const shouldPadBleed =
        cardStandard.requiresBleed && !initialAnalysis.geometry.has3mmBleed;

      const workingAnalysis = shouldPadBleed
        ? runFullPrintPipeline({
            sourceCanvas: c,
            inputMode,
            cardStandard,
            printerProfile,
            adjustments: {
              shadowLift: 0,
              gamma: 1.0,
              brightness: 0,
              contrast: 0,
              saturation: 0,
              sharpen: 0,
              textBoxSharpen: 0
            },
            padMpcBleed: true
          })!
        : initialAnalysis;

      const optParams = optimizePrintAdjustments({
        rawPixels: workingAnalysis.rawAnalysisPixels,
        anW: workingAnalysis.anW,
        anH: workingAnalysis.anH,
        has3mmBleed: workingAnalysis.geometry.has3mmBleed,
        inputMode,
        printerProfile,
        printer3DLut: workingAnalysis.printer3DLut,
        resolutionScore: workingAnalysis.resolutionScore,
        artOpticalPpi: workingAnalysis.geometry.effectiveOpticalPpi,
        textOpticalPpi: workingAnalysis.geometry.textOpticalPpi,
        applyUserAdjustmentsFn: applyUserAdjustments
      });

      const finalAnalysis = runFullPrintPipeline({
        sourceCanvas: c,
        inputMode,
        cardStandard,
        printerProfile,
        adjustments: optParams,
        padMpcBleed: shouldPadBleed
      })!;

      const thumbs = generateBatchThumbnails(
        c,
        shouldPadBleed,
        finalAnalysis.geometry.has3mmBleed,
        inputMode,
        optParams,
        finalAnalysis.printer3DLut
      );

      return {
        id,
        fileName,
        sourceCanvas: c,
        padBleed: shouldPadBleed,
        adjustments: optParams,
        baselineScores: initialAnalysis.baseline.scores,
        optimizedScores: finalAnalysis.current.scores,
        geometry: finalAnalysis.geometry,
        origThumbUrl: thumbs.origThumbUrl,
        simThumbUrl: thumbs.simThumbUrl
      };
    },
    [inputMode, cardStandard, printerProfile]
  );

  // Re-optimize existing batch items whenever inputMode, cardStandard, or printerProfile changes
  useEffect(() => {
    if (batchItems.length === 0) return;
    setBatchItems((prev) =>
      prev.map((item) => buildOptimizedBatchItem(item.sourceCanvas, item.fileName, item.id))
    );
  }, [inputMode, cardStandardId, printerProfileId]);

  // Handle multi-file upload in Batch Auto-Adjust mode
  const handleBatchFilesUpload = useCallback(
    async (fileList: FileList | File[] | null) => {
      if (!fileList || fileList.length === 0) return;
      const files = Array.from(fileList);
      setIsBatchProcessing(true);
      setStudioMode('batch');

      const loadFileAsCanvas = (file: File): Promise<{ canvas: HTMLCanvasElement; name: string }> =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const c = document.createElement('canvas');
              c.width = img.naturalWidth || img.width;
              c.height = img.naturalHeight || img.height;
              const ctx = c.getContext('2d')!;
              ctx.drawImage(img, 0, 0);
              resolve({ canvas: c, name: file.name });
            };
            img.onerror = reject;
            img.src = e.target?.result as string;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

      try {
        const newItems: BatchCardItem[] = [];
        for (let i = 0; i < files.length; i++) {
          const { canvas, name } = await loadFileAsCanvas(files[i]);
          const id = `${Date.now()}_${i}_${name}`;
          newItems.push(buildOptimizedBatchItem(canvas, name, id));
        }
        setBatchItems((prev) => [...prev, ...newItems]);
      } finally {
        setIsBatchProcessing(false);
      }
    },
    [buildOptimizedBatchItem]
  );

  // Load the 4 built-in calibration cards into Batch mode for instant demo/testing
  const handleLoadDemoBatch = () => {
    setIsBatchProcessing(true);
    setStudioMode('batch');
    setTimeout(() => {
      const demoItems = BUILTIN_PRESETS.map((preset, idx) => {
        const c = generatePresetCardCanvas(preset.id);
        return buildOptimizedBatchItem(c, `${preset.id}.png`, `demo_${Date.now()}_${idx}`);
      });
      setBatchItems(demoItems);
      setIsBatchProcessing(false);
    }, 20);
  };

  // Export all batch items as a single print-ready ZIP archive
  const handleExportBatchZip = async () => {
    if (batchItems.length === 0) return;
    setIsExportingZip(true);

    setTimeout(() => {
      try {
        const entries: ZipEntryInput[] = batchItems.map((item, idx) => {
          const outCanvas = renderCardToPrintReadyCanvas(
            item.sourceCanvas,
            item.padBleed,
            item.geometry.has3mmBleed,
            inputMode,
            item.adjustments
          );
          const dataUrl = outCanvas.toDataURL('image/png');
          const bytes = dataUrlToUint8Array(dataUrl);
          const cleanName = item.fileName.replace(/\.[^/.]+$/, '');
          return {
            filename: `${String(idx + 1).padStart(2, '0')}_${cleanName}_print_ready_${outCanvas.width}x${outCanvas.height}.png`,
            data: bytes
          };
        });

        const zipBlob = createZipArchive(entries);
        const url = URL.createObjectURL(zipBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `proxyprint_batch_${printerProfileId}_${batchItems.length}cards.zip`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } finally {
        setIsExportingZip(false);
      }
    }, 20);
  };

  // Open a specific batch card in Single Card Inspector for manual fine-tuning
  const handleInspectBatchItem = (item: BatchCardItem) => {
    setActivePresetId(null);
    setCustomFileName(item.fileName);
    setEditingBatchItemId(item.id);
    setSourceCanvas(item.sourceCanvas);
    setPadMpcBleed(item.padBleed);
    setAdjustments({
      shadowLift: item.adjustments.shadowLift,
      gamma: item.adjustments.gamma,
      brightness: item.adjustments.brightness,
      contrast: item.adjustments.contrast,
      saturation: item.adjustments.saturation,
      sharpen: item.adjustments.sharpen || 0,
      textBoxSharpen: item.adjustments.textBoxSharpen || 0,
      artTargetDpi: item.adjustments.artTargetDpi ?? DPI_BENCHMARKS.ideal,
      textTargetDpi: item.adjustments.textTargetDpi ?? DPI_BENCHMARKS.ideal
    });
    setStudioMode('single');
  };

  // Find if the currently loaded card already exists in the Batch Queue
  const existingBatchMatch = useMemo(() => {
    if (!sourceCanvas) return null;
    const currentName = customFileName || (activePresetId ? `${activePresetId}.png` : 'mtg_proxy.png');
    return (
      batchItems.find(
        (b) =>
          b.id === editingBatchItemId ||
          b.sourceCanvas === sourceCanvas ||
          b.fileName === currentName
      ) || null
    );
  }, [batchItems, editingBatchItemId, sourceCanvas, customFileName, activePresetId]);

  // Save current card & parameters to Batch Queue (overwriting if it already exists, or appending if new)
  const handleSaveCurrentToBatch = () => {
    if (!sourceCanvas || !analysis) return;
    const currentName = customFileName || (activePresetId ? `${activePresetId}.png` : 'mtg_proxy.png');
    const thumbs = generateBatchThumbnails(
      sourceCanvas,
      padMpcBleed,
      analysis.geometry.has3mmBleed,
      inputMode,
      adjustments,
      analysis.printer3DLut
    );

    const targetId = existingBatchMatch ? existingBatchMatch.id : `${Date.now()}_${currentName}`;
    const updatedItem: BatchCardItem = {
      id: targetId,
      fileName: currentName,
      sourceCanvas,
      padBleed: padMpcBleed,
      adjustments: { ...adjustments },
      baselineScores: analysis.baseline.scores,
      optimizedScores: analysis.current.scores,
      geometry: analysis.geometry,
      origThumbUrl: thumbs.origThumbUrl,
      simThumbUrl: thumbs.simThumbUrl
    };

    setBatchItems((prev) => {
      const idx = prev.findIndex((b) => b.id === targetId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updatedItem;
        return copy;
      }
      return [...prev, updatedItem];
    });

    setEditingBatchItemId(targetId);
    setBatchSaveFlash(true);
    setTimeout(() => setBatchSaveFlash(false), 1800);
  };

  const resetAdjustments = () => {
    setAdjustments({
      shadowLift: 0,
      gamma: 1.0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: 0,
      textBoxSharpen: 0,
      artTargetDpi: DPI_BENCHMARKS.min,
      textTargetDpi: DPI_BENCHMARKS.min
    });
    setPadMpcBleed(false);
  };

  const hasAnyAdjustment =
    adjustments.shadowLift !== 0 ||
    adjustments.gamma !== 1.0 ||
    adjustments.brightness !== 0 ||
    adjustments.contrast !== 0 ||
    adjustments.saturation !== 0 ||
    (adjustments.sharpen || 0) !== 0 ||
    (adjustments.textBoxSharpen || 0) !== 0 ||
    (adjustments.artTargetDpi ?? DPI_BENCHMARKS.min) > DPI_BENCHMARKS.min ||
    (adjustments.textTargetDpi ?? DPI_BENCHMARKS.min) > DPI_BENCHMARKS.min ||
    padMpcBleed;

  if (!analysis) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <Activity className="w-5 h-5 animate-spin text-indigo-400" />
          <span>Initializing ProxyPrint Lab Color Engine...</span>
        </div>
      </div>
    );
  }

  const curScores = analysis.current.scores;
  const baseScores = analysis.baseline.scores;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      {/* Studio Header */}
      <StudioHeader
        studioMode={studioMode}
        setStudioMode={setStudioMode}
        backendStatus={backendStatus}
        batchItems={batchItems}
        overallScore={curScores.overall}
        baseOverallScore={baseScores.overall}
        hasAnyAdjustment={hasAnyAdjustment}
        onAutoOptimize={handleAutoOptimize}
        onSaveCurrentToBatch={handleSaveCurrentToBatch}
        batchSaveFlash={batchSaveFlash}
        existingBatchMatch={existingBatchMatch}
        onExportPng={handleExportPng}
        onExportBatchZip={handleExportBatchZip}
        isExportingZip={isExportingZip}
        batchFileInputRef={batchFileInputRef}
        onBatchFilesUpload={handleBatchFilesUpload}
      />

      {/* Main Workspace */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (3 cols): Card Source & Print Target */}
        <section className="lg:col-span-3 space-y-5">
          <CardSourceSection
            customFileName={customFileName}
            activePresetId={activePresetId}
            onSelectPreset={(presetId) => setActivePresetId(presetId)}
            onImageUpload={handleImageUpload}
            fileInputRef={fileInputRef}
          />
          <PrintTargetSection
            inputMode={inputMode}
            setInputMode={setInputMode}
            cardStandardId={cardStandardId}
            setCardStandardId={setCardStandardId}
            printerProfileId={printerProfileId}
            setPrinterProfileId={setPrinterProfileId}
          />
        </section>

        {/* Center & Right Columns: Batch Studio vs Single Card Studio */}
        {studioMode === 'batch' ? (
          <BatchStudio
            batchItems={batchItems}
            setBatchItems={setBatchItems}
            printerProfile={printerProfile}
            inputMode={inputMode}
            handleLoadDemoBatch={handleLoadDemoBatch}
            handleExportBatchZip={handleExportBatchZip}
            isExportingZip={isExportingZip}
            isBatchProcessing={isBatchProcessing}
            handleBatchFilesUpload={handleBatchFilesUpload}
            batchFileInputRef={batchFileInputRef}
            handleInspectBatchItem={handleInspectBatchItem}
          />
        ) : (
          <>
            {/* Center Column (5 cols): Visual Soft-Proof Viewer */}
            <SoftProofViewer
              viewMode={viewMode}
              setViewMode={setViewMode}
              showGeometryGuides={showGeometryGuides}
              setShowGeometryGuides={setShowGeometryGuides}
              inputMode={inputMode}
              printerProfile={printerProfile}
              analysis={analysis}
              hasAnyAdjustment={hasAnyAdjustment}
              mainPreviewCanvasRef={mainPreviewCanvasRef}
              origCompareCanvasRef={origCompareCanvasRef}
              simCompareCanvasRef={simCompareCanvasRef}
              heatmapCompareCanvasRef={heatmapCompareCanvasRef}
            />

            {/* Right Column (4 cols): Live Simulator & Diagnostic Scorecard */}
            <section className="lg:col-span-4 flex flex-col gap-5">
              <LiveSimulator
                adjustments={adjustments}
                setAdjustments={setAdjustments}
                hasAnyAdjustment={hasAnyAdjustment}
                resetAdjustments={resetAdjustments}
                analysis={analysis}
                inputMode={inputMode}
                padMpcBleed={padMpcBleed}
                setPadMpcBleed={setPadMpcBleed}
                handleSaveCurrentToBatch={handleSaveCurrentToBatch}
                batchSaveFlash={batchSaveFlash}
                existingBatchMatch={existingBatchMatch}
                setStudioMode={setStudioMode}
              />
              <DiagnosticScorecard
                cardStandard={cardStandard}
                printerProfile={printerProfile}
                analysis={analysis}
              />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
