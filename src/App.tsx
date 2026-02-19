import { useState, useCallback, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import epub from "epub-gen-memory/bundle";
import "./App.css";
import { SettingsWindow, loadProfiles, saveSettings } from "./SettingsWindow";
import type { Profile } from "./SettingsWindow";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

interface FileHistoryItem {
  id: string;
  title: string;
  datetime: Date;
  file: File;
  url: string;
  extractedText: string[];
  /** True when this file had no extractable text and uses the VLM image flow */
  isImageFlow?: boolean;
  /** 0-based index of last page successfully processed by the VLM (undefined = none yet) */
  vlmLastPage?: number;
}

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fileHistory, setFileHistory] = useState<FileHistoryItem[]>([]);
  const [currentFile, setCurrentFile] = useState<FileHistoryItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [editedTexts, setEditedTexts] = useState<Record<string, string[]>>({});
  const [bookMetadata, setBookMetadata] = useState<Record<string, { title: string; author: string }>>({});
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>("");
  // VLM image flow state
  const [vlmLoading, setVlmLoading] = useState(false);
  const [vlmProgress, setVlmProgress] = useState(0);
  const [vlmTotal, setVlmTotal] = useState(0);
  const cancelRequestedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const { profiles: p, activeProfileId: id } = loadProfiles();
    setProfiles(p);
    setActiveProfileId(id);
  }, []);

  const handleSettingsClose = useCallback((updatedProfiles: Profile[], updatedActiveId: string) => {
    setProfiles(updatedProfiles);
    setActiveProfileId(updatedActiveId);
    saveSettings(updatedProfiles, updatedActiveId);
    setSettingsOpen(false);
  }, []);
  const handleMetadataChange = useCallback((fileId: string, field: "title" | "author", value: string, defaultTitle: string) => {
    setBookMetadata((prev) => ({
      ...prev,
      [fileId]: {
        title: prev[fileId]?.title ?? defaultTitle,
        author: prev[fileId]?.author ?? "",
        [field]: value,
      },
    }));
  }, []);

  const handlePageTextChange = useCallback((fileId: string, pageIndex: number, value: string, originalPages: string[]) => {
    setEditedTexts((prev) => {
      const current = prev[fileId] ?? [...originalPages];
      const updated = [...current];
      updated[pageIndex] = value;
      return { ...prev, [fileId]: updated };
    });
  }, []);

  const resetToOriginal = useCallback((fileId: string) => {
    setEditedTexts((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  }, []);

  const downloadEpub = useCallback(async (file: FileHistoryItem, pages: string[], metadata: { title: string; author: string }) => {
    const chapters = pages.map((pageText, index) => ({
      title: `Page ${index + 1}`,
      content: `<p>${pageText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "</p><p>")}</p>`,
    }));

    const blob = await epub(
      {
        title: metadata.title || file.title,
        author: metadata.author || "Unknown",
      },
      chapters
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${metadata.title || file.title}.epub`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const extractTextFromPdf = async (file: File): Promise<{ pages: string[]; hasText: boolean }> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push(pageText);
    }

    // Consider text present only if at least one page has a meaningful amount of text
    const hasText = pages.some((t) => t.trim().length > 20);
    return { pages, hasText };
  };

  /** Render a single PDF page to a JPEG data URL */
  const renderPageAsDataUrl = async (pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number): Promise<string> => {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const context = canvas.getContext("2d")!;
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  };

  const runImageFlow = useCallback(
    async (fileItem: FileHistoryItem, startPage: number, activeProfiles: Profile[], activeProfileIdVal: string) => {
      const activeProfile = activeProfiles.find((p) => p.id === activeProfileIdVal);
      if (!activeProfile || !activeProfile.baseUrl) {
        alert("Please configure a VLM provider in Settings before using the image flow.");
        return;
      }

      const arrayBuffer = await fileItem.file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdfDoc.numPages;

      cancelRequestedRef.current = false;
      setVlmLoading(true);
      setVlmTotal(totalPages);
      setVlmProgress(startPage);

      // Ensure extractedText array has the right length
      setFileHistory((prev) =>
        prev.map((f) => {
          if (f.id !== fileItem.id) return f;
          const texts = [...f.extractedText];
          while (texts.length < totalPages) texts.push("");
          return { ...f, extractedText: texts, isImageFlow: true };
        })
      );

      for (let i = startPage; i < totalPages; i++) {
        if (cancelRequestedRef.current) break;

        let pageText = "";
        try {
          const dataUrl = await renderPageAsDataUrl(pdfDoc, i + 1);

          if (cancelRequestedRef.current) break;

          const controller = new AbortController();
          abortControllerRef.current = controller;

          const response = await fetch(`${activeProfile.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${activeProfile.apiKey}`,
            },
            body: JSON.stringify({
              model: activeProfile.model,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "image_url", image_url: { url: dataUrl } },
                    { type: "text", text: activeProfile.prompt },
                  ],
                },
              ],
              stream: false,
              max_tokens: 4096,
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            throw new Error(`API responded with status ${response.status}`);
          }

          const data = await response.json();
          pageText = data.choices?.[0]?.message?.content ?? "";
        } catch (err: unknown) {
          if (cancelRequestedRef.current) break;
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error processing page ${i + 1}:`, err);
          pageText = `[Error processing page ${i + 1}: ${message}]`;
        }

        if (cancelRequestedRef.current) break;

        const pageIndex = i;
        setFileHistory((prev) =>
          prev.map((f) => {
            if (f.id !== fileItem.id) return f;
            const texts = [...f.extractedText];
            texts[pageIndex] = pageText;
            return { ...f, extractedText: texts, vlmLastPage: pageIndex };
          })
        );
        // Keep currentFile in sync so buttons update
        setCurrentFile((prev) => {
          if (!prev || prev.id !== fileItem.id) return prev;
          const texts = [...prev.extractedText];
          texts[pageIndex] = pageText;
          return { ...prev, extractedText: texts, vlmLastPage: pageIndex };
        });

        setVlmProgress(i + 1);
      }

      setVlmLoading(false);
      cancelRequestedRef.current = false;
    },
    []
  );

  const handleCancelVlm = useCallback(() => {
    cancelRequestedRef.current = true;
    abortControllerRef.current?.abort();
  }, []);

  const handleResumeVlm = useCallback(() => {
    if (!currentFile?.isImageFlow || vlmLoading) return;
    const startPage = (currentFile.vlmLastPage ?? -1) + 1;
    if (startPage >= currentFile.extractedText.length) return;
    runImageFlow(currentFile, startPage, profiles, activeProfileId);
  }, [currentFile, vlmLoading, runImageFlow, profiles, activeProfileId]);

  const handleRescanText = useCallback(async () => {
    if (!currentFile || currentFile.isImageFlow || isExtracting) return;
    setIsExtracting(true);
    try {
      const { pages, hasText } = await extractTextFromPdf(currentFile.file);
      const updatedItem: FileHistoryItem = {
        ...currentFile,
        extractedText: hasText ? pages : new Array(pages.length).fill(""),
        isImageFlow: !hasText,
        vlmLastPage: undefined,
      };
      setFileHistory((prev) => prev.map((f) => (f.id === currentFile.id ? updatedItem : f)));
      setCurrentFile(updatedItem);
      setEditedTexts((prev) => {
        const next = { ...prev };
        delete next[currentFile.id];
        return next;
      });
      if (!hasText) {
        setIsExtracting(false);
        runImageFlow(updatedItem, 0, profiles, activeProfileId);
        return;
      }
    } catch (error) {
      console.error("Error re-extracting text:", error);
    } finally {
      setIsExtracting(false);
    }
  }, [currentFile, isExtracting, profiles, activeProfileId, runImageFlow]);

  const handleRescanVlm = useCallback(() => {
    if (!currentFile?.isImageFlow || vlmLoading) return;
    // Reset extracted text and vlmLastPage, then start from scratch
    const totalPages = currentFile.extractedText.length;
    const resetItem: FileHistoryItem = {
      ...currentFile,
      extractedText: new Array(totalPages).fill(""),
      vlmLastPage: undefined,
    };
    setFileHistory((prev) => prev.map((f) => (f.id === currentFile.id ? resetItem : f)));
    setCurrentFile(resetItem);
    setEditedTexts((prev) => {
      const next = { ...prev };
      delete next[currentFile.id];
      return next;
    });
    runImageFlow(resetItem, 0, profiles, activeProfileId);
  }, [currentFile, vlmLoading, runImageFlow, profiles, activeProfileId]);

  useEffect(() => {
    return () => {
      fileHistory.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      alert("Please upload a PDF file");
      return;
    }

    const existingItem = fileHistory.find((item) => item.file.name === file.name);
    if (existingItem) {
      setCurrentFile(existingItem);
      return;
    }

    setIsExtracting(true);

    try {
      const { pages, hasText } = await extractTextFromPdf(file);

      const newItem: FileHistoryItem = {
        id: crypto.randomUUID(),
        title: file.name.replace(/\.pdf$/i, ""),
        datetime: new Date(),
        file,
        url: URL.createObjectURL(file),
        extractedText: hasText ? pages : new Array(pages.length).fill(""),
        isImageFlow: !hasText,
      };

      setFileHistory((prev) => [newItem, ...prev]);
      setCurrentFile(newItem);

      if (!hasText) {
        setIsExtracting(false);
        runImageFlow(newItem, 0, profiles, activeProfileId);
        return;
      }
    } catch (error) {
      console.error("Error extracting text:", error);
      const newItem: FileHistoryItem = {
        id: crypto.randomUUID(),
        title: file.name.replace(/\.pdf$/i, ""),
        datetime: new Date(),
        file,
        url: URL.createObjectURL(file),
        extractedText: [],
      };

      setFileHistory((prev) => [newItem, ...prev]);
      setCurrentFile(newItem);
    } finally {
      setIsExtracting(false);
    }
  }, [fileHistory, profiles, activeProfileId, runImageFlow]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounterRef.current = 0;
      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect]
  );

  const removeCurrentFile = useCallback(() => {
    setCurrentFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const selectHistoryItem = useCallback((item: FileHistoryItem) => {
    setCurrentFile(item);
  }, []);

  const removeFromHistory = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setFileHistory((prev) => {
        const item = prev.find((i) => i.id === id);
        if (item) {
          URL.revokeObjectURL(item.url);
        }
        return prev.filter((i) => i.id !== id);
      });
      if (currentFile?.id === id) {
        setCurrentFile(null);
      }
    },
    [currentFile]
  );

  const formatDateTime = (date: Date) => {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="app-container">
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? ">" : "<"}
        </button>
        {!sidebarCollapsed && (
          <div className="sidebar-content">
            <h2>History</h2>
            <div className="history-list">
              {fileHistory.length === 0 ? (
                <p className="empty-history">No files uploaded yet</p>
              ) : (
                fileHistory.map((item) => (
                  <div
                    key={item.id}
                    className={`history-item ${currentFile?.id === item.id ? "active" : ""}`}
                    onClick={() => selectHistoryItem(item)}
                  >
                    <div className="history-item-info">
                      <span className="history-item-title">{item.title}</span>
                      <span className="history-item-datetime">{formatDateTime(item.datetime)}</span>
                    </div>
                    <button
                      className="history-item-remove"
                      onClick={(e) => removeFromHistory(item.id, e)}
                      title="Remove from history"
                    >
                      X
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>

      <main
        className={`main-content ${isDragging ? "dragging" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="drag-overlay">
            <div className="drag-overlay-content">
              <div className="upload-icon">+</div>
              <p>Drop PDF here</p>
            </div>
          </div>
        )}
        <header className="main-header">
          <h1>Pdf2Epub</h1>
          <div className="subtitle-row">
            <p className="subtitle">Transform your PDFs for the perfect e-reader experience</p>
            <button
              className="settings-btn"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </div>
        </header>
        {settingsOpen && (
          <SettingsWindow
            initialProfiles={profiles}
            initialActiveProfileId={activeProfileId}
            onClose={handleSettingsClose}
          />
        )}
        <div className="upload-section">
          {currentFile ? (
            <div className="file-meta-row">
              <div className="file-meta-left">
                <span className="current-file-title">{currentFile.title}</span>
                <button className="remove-file-btn" onClick={removeCurrentFile}>X</button>
                {currentFile.isImageFlow && !vlmLoading && (
                  <>
                    {(currentFile.vlmLastPage ?? -1) >= 0 &&
                      (currentFile.vlmLastPage ?? -1) < currentFile.extractedText.length - 1 && (
                      <button
                        className="vlm-action-btn vlm-resume-btn"
                        onClick={handleResumeVlm}
                        title="Resume VLM processing from where it left off"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      className="vlm-action-btn vlm-rescan-btn"
                      onClick={handleRescanVlm}
                      title="Re-process all pages with the VLM from scratch"
                    >
                      Rescan
                    </button>
                  </>
                )}
                {!currentFile.isImageFlow && !isExtracting && (
                  <button
                    className="vlm-action-btn vlm-rescan-btn"
                    onClick={handleRescanText}
                    title="Re-extract text from PDF"
                  >
                    Rescan
                  </button>
                )}
              </div>
              <div className="file-meta-right">
                <div className="meta-field">
                  <label className="meta-label">Title</label>
                  <input
                    className="meta-input"
                    type="text"
                    value={bookMetadata[currentFile.id]?.title ?? currentFile.title}
                    onChange={(e) => handleMetadataChange(currentFile.id, "title", e.target.value, currentFile.title)}
                    placeholder="Book title"
                  />
                </div>
                <div className="meta-field">
                  <label className="meta-label">Author</label>
                  <input
                    className="meta-input"
                    type="text"
                    value={bookMetadata[currentFile.id]?.author ?? ""}
                    onChange={(e) => handleMetadataChange(currentFile.id, "author", e.target.value, currentFile.title)}
                    placeholder="Author name"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div
              className="upload-box"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="upload-icon">+</div>
              <p>Click or drag PDF here</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleInputChange}
            style={{ display: "none" }}
          />
        </div>

        {currentFile && (
          <div className="file-content">
            <div className="split-view">
              <div className="pdf-panel">
                <object data={currentFile.url} type="application/pdf" width="100%" height="100%">
                  <p>Unable to display PDF. <a href={currentFile.url}>Download instead</a></p>
                </object>
              </div>
              <div className="text-panel">
                <div className="text-panel-header">
                  <span>Extracted Text</span>
                  <div className="text-panel-header-actions">
                    {!isExtracting && currentFile.extractedText.length > 0 && (
                      <button
                        className="download-epub-btn"
                        onClick={() =>
                          downloadEpub(
                            currentFile,
                            editedTexts[currentFile.id] ?? currentFile.extractedText,
                            {
                              title: bookMetadata[currentFile.id]?.title ?? currentFile.title,
                              author: bookMetadata[currentFile.id]?.author ?? "",
                            }
                          )
                        }
                      >
                        ⬇️ Epub
                      </button>
                    )}
                    {!isExtracting && currentFile.extractedText.length > 0 && editedTexts[currentFile.id] && (
                      <button
                        className="original-extraction-btn"
                        onClick={() => resetToOriginal(currentFile.id)}
                        title="Reset to original extracted text"
                      >
                        Original Extraction
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-content">
                  {isExtracting ? (
                    <p className="extracting">Extracting text...</p>
                  ) : currentFile.extractedText.length > 0 ? (
                    (editedTexts[currentFile.id] ?? currentFile.extractedText).map((pageText, index) => (
                      <div key={index} className="text-page">
                        <div className="page-marker">Page {index + 1}</div>
                        {currentFile.isImageFlow && pageText === "" ? (
                          <p className="vlm-page-pending">Waiting for VLM…</p>
                        ) : (
                          <textarea
                            className="page-text-editor"
                            value={pageText}
                            onChange={(e) => {
                              e.target.style.height = "auto";
                              e.target.style.height = e.target.scrollHeight + "px";
                              handlePageTextChange(
                                currentFile.id,
                                index,
                                e.target.value,
                                currentFile.extractedText
                              );
                            }}
                            ref={(el) => {
                              if (el) {
                                el.style.height = "auto";
                                el.style.height = el.scrollHeight + "px";
                              }
                            }}
                            spellCheck={false}
                          />
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="no-text">No text could be extracted from this PDF.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* VLM Image Flow Loading Overlay */}
      {vlmLoading && (
        <div className="vlm-overlay">
          <div className="vlm-overlay-card">
            <h3 className="vlm-overlay-title">Processing Pages with AI</h3>
            <p className="vlm-overlay-subtitle">
              Page {vlmProgress} of {vlmTotal}
            </p>
            <div className="vlm-progress-track">
              <div
                className="vlm-progress-fill"
                style={{ width: `${vlmTotal > 0 ? (vlmProgress / vlmTotal) * 100 : 0}%` }}
              />
            </div>
            <p className="vlm-progress-pct">
              {vlmTotal > 0 ? Math.round((vlmProgress / vlmTotal) * 100) : 0}%
            </p>
            <button className="vlm-cancel-btn" onClick={handleCancelVlm}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;