import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import "./SettingsWindow.css";

export interface Profile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
}

export const PRESET_BASE_URLS: { name: string; url: string }[] = [
  { name: "Cerebras", url: "https://api.cerebras.ai/v1" },
  { name: "DeepSeek", url: "https://api.deepseek.com" },
  { name: "Fireworks AI", url: "https://api.fireworks.ai/inference/v1" },
  { name: "Google AI Studio", url: "https://generativelanguage.googleapis.com/v1beta/openai/" },
  { name: "Groq", url: "https://api.groq.com/openai/v1" },
  { name: "Hugging Face", url: "https://api-inference.huggingface.co/v1" },
  { name: "KoboldCPP", url: "http://localhost:5001/v1" },
  { name: "llama.cpp", url: "http://localhost:8080/v1" },
  { name: "LM Studio", url: "http://localhost:1234/v1" },
  { name: "Mistral AI", url: "https://api.mistral.ai/v1" },
  { name: "Ollama", url: "http://localhost:11434/v1" },
  { name: "OpenAI", url: "https://api.openai.com/v1" },
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1" },
  { name: "SambaNova", url: "https://api.sambanova.ai/v1" },
  { name: "Together AI", url: "https://api.together.xyz/v1" },
  { name: "vLLM", url: "http://localhost:8000/v1" },
];

const DEFAULT_PROMPT = "Transcribe the text to the best of your abilities";

function createDefaultProfile(): Profile {
  return {
    id: crypto.randomUUID(),
    name: "New Profile",
    baseUrl: "",
    apiKey: "api_key",
    model: "",
    prompt: DEFAULT_PROMPT,
  };
}

export function loadProfiles(): { profiles: Profile[]; activeProfileId: string } {
  try {
    const raw = localStorage.getItem("pdf2epub_settings");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.profiles?.length > 0) {
        return parsed;
      }
    }
  } catch {
    /* ignore */
  }
  const defaultProfile = createDefaultProfile();
  return { profiles: [defaultProfile], activeProfileId: defaultProfile.id };
}

export function saveSettings(profiles: Profile[], activeProfileId: string) {
  localStorage.setItem("pdf2epub_settings", JSON.stringify({ profiles, activeProfileId }));
}

// ------- Combobox Component -------

interface ComboboxProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  /** Called only when an option is explicitly chosen from the dropdown list */
  onSelectOption?: (val: string, label: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
  id?: string;
  /** Auto-open dropdown and focus input when mounted */
  openOnMount?: boolean;
}

interface ComboboxHandle {
  focus: () => void;
}

const Combobox = forwardRef<ComboboxHandle, ComboboxProps>(function Combobox(
  { value, onChange, onBlur, onSelectOption, options, placeholder, id, openOnMount },
  ref
) {
  const [open, setOpen] = useState(openOnMount ?? false);
  const [filter, setFilter] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      setOpen(true);
      setFilter("");
    },
  }));

  const filtered = options.filter(
    (o) =>
      !filter ||
      o.label.toLowerCase().includes(filter.toLowerCase()) ||
      o.value.toLowerCase().includes(filter.toLowerCase())
  );

  // Auto-focus when mounted with openOnMount
  useEffect(() => {
    if (openOnMount) {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter("");
        setHighlightedIndex(-1);
        onBlur?.();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onBlur]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    setFilter(e.target.value);
    setHighlightedIndex(-1);
    setOpen(true);
  };

  const handleSelect = useCallback(
    (val: string, label: string) => {
      onChange(val);
      onSelectOption?.(val, label);
      setOpen(false);
      setFilter("");
      setHighlightedIndex(-1);
    },
    [onChange, onSelectOption]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        setFilter("");
        setHighlightedIndex(0);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
        setFilter("");
        setHighlightedIndex(filtered.length - 1);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filtered.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (highlightedIndex <= 0) {
        setHighlightedIndex(-1);
        // cursor stays in input
      } else {
        setHighlightedIndex((prev) => prev - 1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && filtered[highlightedIndex]) {
        const opt = filtered[highlightedIndex];
        handleSelect(opt.value, opt.label);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className="sw-combobox" ref={containerRef}>
      <div className="sw-combobox-input-row">
        <input
          id={id}
          ref={inputRef}
          type="text"
          className="sw-input"
          value={value}
          onChange={handleInputChange}
          onFocus={() => {
            setFilter("");
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
        />
        <button
          type="button"
          className="sw-combobox-arrow"
          tabIndex={-1}
          onClick={() => {
            const next = !open;
            setOpen(next);
            setFilter("");
            setHighlightedIndex(-1);
            if (next) inputRef.current?.focus();
          }}
        >
          ▾
        </button>
      </div>
      {open && filtered.length > 0 && (
        <ul className="sw-combobox-dropdown" ref={listRef} role="listbox">
          {filtered.map((o, idx) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={[
                "sw-combobox-option",
                o.value === value ? "selected" : "",
                idx === highlightedIndex ? "highlighted" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before select
                handleSelect(o.value, o.label);
              }}
              onMouseEnter={() => setHighlightedIndex(idx)}
            >
              <span className="sw-combobox-option-label">{o.label}</span>
              <span className="sw-combobox-option-url">{o.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

// ------- ProfileListItem -------

interface ProfileListItemProps {
  profile: Profile;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

function ProfileListItem({ profile, isActive, onSelect, onDelete }: ProfileListItemProps) {
  const [confirming, setConfirming] = useState(false);

  const handleTrashClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(true);
  };

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirming(false);
  };

  return (
    <li
      className={`sw-profile-item${isActive ? " active" : ""}`}
      onClick={onSelect}
      onMouseLeave={() => setConfirming(false)}
    >
      <span className="sw-profile-name">{profile.name}</span>
      {confirming ? (
        <span className="sw-profile-confirm">
          <button
            type="button"
            className="sw-confirm-check"
            title="Confirm delete"
            onClick={handleConfirm}
          >
            ✓
          </button>
          <button
            type="button"
            className="sw-confirm-x"
            title="Cancel"
            onClick={handleCancel}
          >
            ✕
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="sw-profile-trash"
          title="Delete profile"
          onClick={handleTrashClick}
        >
          🗑
        </button>
      )}
    </li>
  );
}

// ------- Main SettingsWindow -------

interface SettingsWindowProps {
  onClose: (profiles: Profile[], activeProfileId: string) => void;
  initialProfiles: Profile[];
  initialActiveProfileId: string;
}

export function SettingsWindow({ onClose, initialProfiles, initialActiveProfileId }: SettingsWindowProps) {
  const initialProfiles_: Profile[] = initialProfiles.length > 0 ? initialProfiles : [createDefaultProfile()];
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles_);
  const [activeProfileId, setActiveProfileId] = useState(initialActiveProfileId || initialProfiles_[0].id);
  const [selectedProfileId, setSelectedProfileId] = useState(initialActiveProfileId || initialProfiles_[0].id);

  // Form state - mirrors the selected profile
  const [formBaseUrl, setFormBaseUrl] = useState("");
  const [formApiKey, setFormApiKey] = useState("");
  const [formModel, setFormModel] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [formProfileName, setFormProfileName] = useState("");

  // Track whether the user has manually typed the profile name (disables auto-update from Base URL)
  const [profileNameManuallyEdited, setProfileNameManuallyEdited] = useState(false);

  // Key to force remount of Base URL combobox when switching profiles
  const [baseUrlKey, setBaseUrlKey] = useState(0);

  // Model field extras
  const [showApiKey, setShowApiKey] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  // Key to force remount of Model combobox after a successful fetch (triggers openOnMount)
  const [modelFetchKey, setModelFetchKey] = useState(0);
  // Save button feedback
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Populate form when selected profile changes
  useEffect(() => {
    const p = profiles.find((pr) => pr.id === selectedProfileId);
    if (p) {
      setFormBaseUrl(p.baseUrl);
      setFormApiKey(p.apiKey);
      setFormModel(p.model);
      setFormPrompt(p.prompt);
      setFormProfileName(p.name);
      setProfileNameManuallyEdited(false);
      setAvailableModels([]);
      setModelFetchError(null);
      // Remount base URL combobox so openOnMount triggers correctly for empty profiles
      setBaseUrlKey((k) => k + 1);
    }
  // profiles intentionally excluded – only re-run on profile switch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId]);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  const handleBaseUrlBlur = useCallback(() => {
    if (profileNameManuallyEdited) return;
    const matchedPreset = PRESET_BASE_URLS.find((p) => p.url === formBaseUrl);
    if (!matchedPreset && formBaseUrl.trim() !== "") {
      setFormProfileName("Custom");
    }
  }, [formBaseUrl, profileNameManuallyEdited]);

  // Called when user picks an option from the Base URL dropdown
  const handleBaseUrlSelectOption = useCallback(
    (_val: string, label: string) => {
      if (!profileNameManuallyEdited) {
        setFormProfileName(label);
      }
    },
    [profileNameManuallyEdited]
  );

  const handleFetchModels = useCallback(async () => {
    setFetchingModels(true);
    setModelFetchError(null);
    setAvailableModels([]);
    try {
      const url = formBaseUrl.replace(/\/$/, "") + "/models";
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${formApiKey}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      let models: string[] = [];
      if (Array.isArray(json)) {
        models = json.map((m: { id?: string; name?: string } | string) =>
          typeof m === "string" ? m : (m.id ?? m.name ?? String(m))
        );
      } else if (json.data && Array.isArray(json.data)) {
        models = json.data.map((m: { id?: string; name?: string } | string) =>
          typeof m === "string" ? m : (m.id ?? m.name ?? String(m))
        );
      }
      setAvailableModels(models.sort());
      // Force remount of model combobox so it auto-focuses and opens
      setModelFetchKey((k) => k + 1);
    } catch (err) {
      setModelFetchError(err instanceof Error ? err.message : "Failed to fetch models");
    } finally {
      setFetchingModels(false);
    }
  }, [formBaseUrl, formApiKey]);

  const handleSaveProfile = useCallback(() => {
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === selectedProfileId
          ? {
              ...p,
              name: formProfileName.trim() || p.name,
              baseUrl: formBaseUrl,
              apiKey: formApiKey,
              model: formModel,
              prompt: formPrompt,
            }
          : p
      )
    );
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 1200);
  }, [selectedProfileId, formProfileName, formBaseUrl, formApiKey, formModel, formPrompt]);

  const handleAddProfile = useCallback(() => {
    const newProfile: Profile = {
      id: crypto.randomUUID(),
      name: "New Profile",
      baseUrl: "",
      apiKey: "api_key",
      model: "",
      prompt: DEFAULT_PROMPT,
    };
    setProfiles((prev) => [...prev, newProfile]);
    setSelectedProfileId(newProfile.id);
  }, []);

  const handleDeleteProfile = useCallback(
    (id: string) => {
      const next = profiles.filter((p) => p.id !== id);
      const remaining = next.length > 0 ? next : [createDefaultProfile()];
      setProfiles(remaining);

      if (selectedProfileId === id) {
        setSelectedProfileId(remaining[0].id);
      }
      if (activeProfileId === id) {
        setActiveProfileId(remaining[0].id);
      }
    },
    [profiles, selectedProfileId, activeProfileId]
  );

  const handleClose = useCallback(() => {
    const finalProfiles = profiles.map((p) =>
      p.id === selectedProfileId
        ? {
            ...p,
            name: formProfileName.trim() || p.name,
            baseUrl: formBaseUrl,
            apiKey: formApiKey,
            model: formModel,
            prompt: formPrompt,
          }
        : p
    );
    saveSettings(finalProfiles, selectedProfileId);
    onClose(finalProfiles, selectedProfileId);
  }, [profiles, selectedProfileId, formProfileName, formBaseUrl, formApiKey, formModel, formPrompt, onClose]);

  const baseUrlOptions = PRESET_BASE_URLS.map((p) => ({ label: p.name, value: p.url }));
  const modelOptions = availableModels.map((m) => ({ label: m, value: m }));

  // Cleanup saved timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Open Base URL dropdown on mount only when the profile has an empty URL
  const baseUrlOpenOnMount = !selectedProfile?.baseUrl;

  return (
    <div className="sw-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="sw-window" role="dialog" aria-modal="true" aria-label="Settings">
        {/* Header */}
        <div className="sw-header">
          <h2 className="sw-title">Settings</h2>
          <button type="button" className="sw-close-btn" onClick={handleClose} title="Close">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="sw-body">
          {/* Left: Profile list */}
          <aside className="sw-profile-sidebar">
            <div className="sw-profile-sidebar-header">
              <span>Profiles</span>
              <button type="button" className="sw-add-profile-btn" onClick={handleAddProfile} title="Add profile">
                +
              </button>
            </div>
            <ul className="sw-profile-list">
              {profiles.map((p) => (
                <ProfileListItem
                  key={p.id}
                  profile={p}
                  isActive={p.id === selectedProfileId}
                  onSelect={() => setSelectedProfileId(p.id)}
                  onDelete={() => handleDeleteProfile(p.id)}
                />
              ))}
            </ul>
          </aside>

          {/* Right: Settings form */}
          <form className="sw-form" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            {/* Base URL */}
            <div className="sw-field">
              <label className="sw-label" htmlFor="sw-base-url">Base URL</label>
              <Combobox
                key={`base-url-${baseUrlKey}`}
                id="sw-base-url"
                value={formBaseUrl}
                onChange={setFormBaseUrl}
                onBlur={handleBaseUrlBlur}
                onSelectOption={handleBaseUrlSelectOption}
                options={baseUrlOptions}
                placeholder="Enter or select a Base URL"
                openOnMount={baseUrlOpenOnMount}
              />
            </div>

            {/* API Key */}
            <div className="sw-field">
              <label className="sw-label" htmlFor="sw-api-key">API Key</label>
              <div className="sw-password-row">
                <input
                  id="sw-api-key"
                  type={showApiKey ? "text" : "password"}
                  className="sw-input"
                  value={formApiKey}
                  onChange={(e) => setFormApiKey(e.target.value)}
                  placeholder="api_key"
                  autoComplete="new-password"
                  data-form-type="other"
                  data-lpignore="true"
                />
                <button
                  type="button"
                  className="sw-eye-btn"
                  onClick={() => setShowApiKey((v) => !v)}
                  title={showApiKey ? "Hide API key" : "Show API key"}
                >
                  {showApiKey ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Model */}
            <div className="sw-field">
              <div className="sw-label-row">
                <label className="sw-label" htmlFor="sw-model">Model</label>
                <button
                  type="button"
                  className={`sw-refresh-btn${fetchingModels ? " spinning" : ""}`}
                  onClick={handleFetchModels}
                  disabled={fetchingModels}
                  title="Fetch available models"
                >
                  ↻
                </button>
              </div>
              {availableModels.length > 0 ? (
                <Combobox
                  key={`model-${modelFetchKey}`}
                  id="sw-model"
                  value={formModel}
                  onChange={setFormModel}
                  options={modelOptions}
                  placeholder="Select or type a model"
                  openOnMount={true}
                />
              ) : (
                <input
                  id="sw-model"
                  type="text"
                  className="sw-input"
                  value={formModel}
                  onChange={(e) => setFormModel(e.target.value)}
                  placeholder="e.g. gpt-4o-mini"
                  autoComplete="off"
                />
              )}
              {modelFetchError && <p className="sw-error">{modelFetchError}</p>}
            </div>

            {/* Prompt */}
            <div className="sw-field sw-field-grow">
              <label className="sw-label" htmlFor="sw-prompt">Prompt</label>
              <textarea
                id="sw-prompt"
                className="sw-textarea"
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                placeholder={DEFAULT_PROMPT}
                rows={4}
              />
            </div>

            {/* Footer: Profile name + Save */}
            <div className="sw-footer">
              <div className="sw-profile-name-field">
                <label className="sw-label" htmlFor="sw-profile-name">Profile</label>
                <input
                  id="sw-profile-name"
                  type="text"
                  className="sw-input"
                  value={formProfileName}
                  onChange={(e) => {
                    setFormProfileName(e.target.value);
                    setProfileNameManuallyEdited(true);
                  }}
                  placeholder="Profile name"
                  autoComplete="off"
                />
              </div>
              <button type="button" className={`sw-save-btn${saved ? " saved" : ""}`} onClick={handleSaveProfile} disabled={saved}>
                {saved ? "Saved!" : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
