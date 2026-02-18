import { useState, useCallback, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist";
import "./App.css";

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
}

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [fileHistory, setFileHistory] = useState<FileHistoryItem[]>([]);
  const [currentFile, setCurrentFile] = useState<FileHistoryItem | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [editedTexts, setEditedTexts] = useState<Record<string, string[]>>({});
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const extractTextFromPdf = async (file: File): Promise<string[]> => {
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

    return pages;
  };

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
      const extractedText = await extractTextFromPdf(file);

      const newItem: FileHistoryItem = {
        id: crypto.randomUUID(),
        title: file.name.replace(/\.pdf$/i, ""),
        datetime: new Date(),
        file,
        url: URL.createObjectURL(file),
        extractedText,
      };

      setFileHistory((prev) => [newItem, ...prev]);
      setCurrentFile(newItem);
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
  }, [fileHistory]);

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
          <p className="subtitle">Transform your PDFs for the perfect e-reader experience</p>
        </header>
        <div className="upload-section">
          {currentFile ? (
            <div className="current-file-header">
              <span className="current-file-title">{currentFile.title}</span>
              <button className="remove-file-btn" onClick={removeCurrentFile}>
                X
              </button>
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
                <div className="text-content">
                  {isExtracting ? (
                    <p className="extracting">Extracting text...</p>
                  ) : currentFile.extractedText.length > 0 ? (
                    (editedTexts[currentFile.id] ?? currentFile.extractedText).map((pageText, index) => (
                      <div key={index} className="text-page">
                        <div className="page-marker">Page {index + 1}</div>
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
    </div>
  );
}

export default App;