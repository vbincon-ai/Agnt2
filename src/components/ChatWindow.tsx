import React, { useRef, useEffect, useState } from "react";
import {
  Send,
  Trash2,
  Menu,
  Globe,
  Sparkles,
  RefreshCw,
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronUp,
  Database,
  CloudLightning,
  Mic,
  Square,
  Play,
  Pause,
  Paperclip,
  FileText,
  X,
  Image as ImageIcon
} from "lucide-react";
import { ChatSession, Message, ChatAttachment } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatWindowProps {
  session: ChatSession | null;
  onSendMessage: (content: string, audioUrl?: string, files?: ChatAttachment[]) => void;
  onClearSession: () => void;
  isLoading: boolean;
  onToggleSidebar: () => void;
  errorMsg: string | null;
  onToggleDeepThink: () => void;
  onToggleWebSearch: () => void;
  onChangeModel: (model: string) => void;
}

const VoiceMessagePlayer: React.FC<{ audioUrl: string }> = ({ audioUrl }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);

    // Some browsers won't fire loadedmetadata unless audited. Trigger pre-auditing
    if (audio.readyState >= 2) {
      setDuration(audio.duration || 0);
    }

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch((e) => console.warn("Playback prevented:", e));
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const val = parseFloat(e.target.value);
    audio.currentTime = val;
    setCurrentTime(val);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs)) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  return (
    <div className="flex items-center gap-3 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 max-w-[280px] select-none my-1">
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
      <button
        type="button"
        onClick={togglePlayback}
        className="w-8 h-8 rounded-full bg-[#1b5df7] text-white flex items-center justify-center hover:bg-blue-600 transition-colors cursor-pointer shrink-0"
      >
        {isPlaying ? (
          <Pause size={13} fill="currentColor" />
        ) : (
          <Play size={13} className="ml-0.5" fill="currentColor" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full accent-[#1b5df7] h-1 bg-zinc-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        <div className="flex justify-between text-[9px] text-zinc-400 font-mono mt-1 select-none">
          <span>{formatTime(currentTime)}</span>
          <span>{duration ? formatTime(duration) : "0:00"}</span>
        </div>
      </div>
    </div>
  );
};

export const ChatWindow: React.FC<ChatWindowProps> = ({
  session,
  onSendMessage,
  onClearSession,
  isLoading,
  onToggleSidebar,
  errorMsg,
  onToggleDeepThink,
  onToggleWebSearch,
  onChangeModel,
}) => {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // File/image attachment states
  const [selectedFiles, setSelectedFiles] = useState<ChatAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const filesArray = Array.from(e.target.files);
    processFiles(filesArray);
  };

  const processFiles = (files: File[]) => {
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result as string;
        const newAttachment: ChatAttachment = {
          name: file.name,
          type: file.type || "application/octet-stream",
          base64: base64,
          size: file.size
        };
        setSelectedFiles((prev) => [...prev, newAttachment]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const filesArray = Array.from(e.dataTransfer.files);
      processFiles(filesArray);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Voice recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Recording Timer
  useEffect(() => {
    let interval: any = null;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setRecordDuration(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const startRecording = async () => {
    setVoiceError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Ваш браузер или платформа не поддерживает воспроизведение или запись аудио.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        const audioBlob = new Blob(chunks, { type: "audio/webm" });
        if (audioBlob.size < 500) {
          // Too small audio data
          return;
        }

        setIsTranscribing(true);
        try {
          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            const base64data = reader.result as string;

            const response = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                audio: base64data,
                mimeType: "audio/webm",
              }),
            });

            if (!response.ok) {
              const errInfo = await response.json();
              throw new Error(errInfo.error || "Ошибка расшифровки аудио.");
            }

            const data = await response.json();
            const text = data.text || "";

            if (!text.trim()) {
              setVoiceError("Голос не распознан. Пожалуйста, повторите фразу более четко.");
            } else {
              onSendMessage(text.trim(), base64data);
            }
          };
        } catch (err: any) {
          console.error("Transcription client error:", err);
          setVoiceError(err.message || "Ошибка распознавания голоса.");
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err: any) {
      console.error("Microphone capture failed:", err);
      setVoiceError(
        "Не удалось получить доступ к микрофону. Разрешите права на запись во фрейме/браузере и убедитесь, что GEMINI_API_KEY добавлен в настройки Secrets."
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    setIsRecording(false);
  };

  const cancelRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.onstop = () => {
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      };
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    }
    setIsRecording(false);
    setRecordDuration(0);
  };

  // Thinking toggles UI expanded states
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  // Auto-scroll to bottom of conversation
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [session?.messages?.length, isLoading]);

  // Handle textarea height auto-adjust
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const minHeight = 72; // Default to about 3 lines
      const newHeight = Math.max(textareaRef.current.scrollHeight, minHeight);
      textareaRef.current.style.height = `${Math.min(newHeight, 180)}px`;
    }
  }, [input]);

  const handleSendText = () => {
    if ((!input.trim() && selectedFiles.length === 0) || isLoading) return;
    onSendMessage(input.trim(), undefined, selectedFiles);
    setInput("");
    setSelectedFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const toggleThoughtVisibility = (messageId: string) => {
    setExpandedThoughts((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  if (!session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white p-6 text-center select-none">
        <Sparkles size={40} className="text-[#1b5df7]/25 mb-3 animate-pulse" />
        <h3 className="text-base font-semibold text-zinc-950 font-sans">Нет активной сессии</h3>
        <p className="text-xs text-zinc-500 mt-2 max-w-xs font-sans">
          Нажмите кнопку «Новый чат» в боковой панели, чтобы начать диалог In-Con.
        </p>
      </div>
    );
  }

  const { messages, deepThink, webSearch } = session;

  const standardModels = [
    "auto",
    "deepseek-chat",
    "deepseek-reasoning",
    "gemini-3.5-flash",
    "openai/gpt-4o",
    "openai/gpt-4o-mini",
    "anthropic/claude-3-5-sonnet",
    "google/gemini-2.5-pro"
  ];
  const isCustomModel = session.model && !standardModels.includes(session.model);

  return (
    <div className="flex-1 flex flex-col h-full bg-white relative">
      {/* Viewport Header */}
      <header className="h-14 border-b border-[#e8ecf1] flex items-center justify-between px-4 bg-white shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleSidebar}
            className="lg:hidden p-2 -ml-2 rounded-lg text-zinc-500 hover:bg-zinc-150 hover:text-zinc-900 cursor-pointer"
          >
            <Menu size={18} />
          </button>
          <div>
            <h2 className="text-xs sm:text-sm font-semibold text-zinc-900 line-clamp-1 max-w-[200px] sm:max-w-xs font-sans">
              {session.title || "Новый диалог"}
            </h2>
          </div>
        </div>

        {/* Global Toolbar and connection indicators */}
        <div className="flex items-center gap-3">
          {messages.length > 0 && (
            <button
              onClick={onClearSession}
              title="Очистить диалог"
              className="p-1.5 rounded-lg text-zinc-450 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-colors cursor-pointer"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </header>

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto bg-white scrollbar-thin flex flex-col">
        {messages.length === 0 ? (
          /* Empty Chat Welcome Page - Exactly mimicking DeepSeek style */
          <div className="flex-1 flex flex-col justify-center items-center px-4 max-w-xl mx-auto w-full select-none text-center">
            {/* Round DeepSeek icon */}
            <div className="w-14 h-14 rounded-full bg-[#1b5df7] flex items-center justify-center text-white mb-6 animate-scale shadow-xs">
              <Brain size={28} className="text-white shrink-0" />
            </div>
            <h3 className="text-xl font-bold text-zinc-950 tracking-tight font-sans">
              Как я могу помочь вам сегодня?
            </h3>
            <p className="text-xs sm:text-sm text-zinc-500 mt-2.5 max-w-xl leading-relaxed font-sans">
              Я — корпоративный <span className="text-[#1b5df7] font-semibold">Суперагент Ин-Кон</span>, построенный на базе самообучающейся когнитивной архитектуры. Я способен самостоятельно программировать и адаптировать свои алгоритмы под наши бизнес-задачи, непрерывно накапливать уникальный корпоративный опыт в реальном времени и автоматически задействовать передовые глобальные и свои корпоративные ИИ модели для достижения безупречных результатов. Просто поставьте задачу!
            </p>

            {/* Quick tips */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-8 w-full max-w-lg font-sans">
              <button
                onClick={() => setInput("Проанализируй текущие тренды автоматизации бизнес-процессов в нашей нише и предложи стратегию внедрения")}
                className="p-3.5 bg-zinc-50 hover:bg-zinc-100 hover:border-blue-500/30 text-left border border-zinc-200 rounded-xl transition-all cursor-pointer text-xs"
              >
                <div className="font-semibold text-zinc-900">📊 Аналитика и стратегии</div>
                <div className="text-zinc-500 mt-0.5 line-clamp-1 text-[11px]">Интеллектуальный анализ рынков и разработка планов</div>
              </button>
              <button
                onClick={() => setInput("Помоги спроектировать алгоритм автоматической классификации входящих заявок с обучением на лету")}
                className="p-3.5 bg-zinc-50 hover:bg-zinc-100 hover:border-blue-500/30 text-left border border-zinc-200 rounded-xl transition-all cursor-pointer text-xs"
              >
                <div className="font-semibold text-zinc-900">⚙️ Самообучающиеся решения</div>
                <div className="text-zinc-500 mt-0.5 line-clamp-1 text-[11px]">Алгоритмы автоматического распознавания и оптимизации</div>
              </button>
            </div>
          </div>
        ) : (
          /* Message items list */
          <div className="flex-1 max-w-3xl w-full mx-auto px-4 py-6 sm:py-8 space-y-8 select-text font-sans">
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const thoughtExpanded = expandedThoughts[msg.id] !== false; // defaults to true

              return (
                <div key={msg.id} className="flex gap-4 items-start animate-fade">
                  {/* Left avatar placeholder */}
                  <div
                    className={`w-7 sm:w-8 h-7 sm:h-8 rounded-full shrink-0 flex items-center justify-center select-none text-xs ${
                      isUser
                        ? "bg-zinc-200 text-zinc-700 border border-zinc-300"
                        : "bg-[#1b5df7] text-white"
                    }`}
                  >
                    {isUser ? "Вы" : <Brain size={14} className="text-white shrink-0" />}
                  </div>

                  {/* Message content block */}
                  <div className="min-w-0 flex-1 space-y-3.5 leading-relaxed font-sans text-[15px]">
                    {/* Header bar */}
                    <div className="flex items-center gap-2">
                       <span className="text-xs font-semibold text-zinc-900">
                        {isUser ? "Вы" : "Ин-Кон"}
                      </span>
                      <span className="text-[10px] text-zinc-400 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>

                    {/* DeepSeek R1 Thinking visual block */}
                    {!isUser && msg.reasoningContent && (
                      <div className="border-l-2 border-[#1b5df7]/20 pl-3 py-0.5 space-y-2">
                        <button
                          onClick={() => toggleThoughtVisibility(msg.id)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500 hover:text-[#1b5df7] transition-all cursor-pointer select-none"
                        >
                          <Brain size={13} className="text-zinc-500" />
                          <span>
                            {thoughtExpanded ? "Свернуть рассуждения" : "Показать рассуждения"}
                          </span>
                          {msg.thinkingTime && (
                            <span className="text-[11px] font-mono bg-zinc-100 text-zinc-600 rounded-md px-1.5 py-0.2 ml-1">
                              Размышление: {msg.thinkingTime} сек
                            </span>
                          )}
                          {thoughtExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>

                        {thoughtExpanded && (
                          <div className="text-xs sm:text-[13px] text-zinc-500 italic leading-relaxed font-sans bg-zinc-50 rounded-lg p-3 border border-zinc-150 select-text whitespace-pre-wrap max-h-96 overflow-y-auto scrollbar-thin">
                            {msg.reasoningContent}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Superagent executed tool calls log */}
                    {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="space-y-2 py-1 select-none">
                        {msg.toolCalls.map((tc, idx) => {
                          const isOk = tc.status === "success";
                          return (
                            <div key={idx} className="border border-zinc-200 rounded-lg bg-zinc-50/50 overflow-hidden text-xs max-w-full font-sans">
                              <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-100/80 border-b border-zinc-200">
                                <div className="flex items-center gap-1.5 font-semibold text-zinc-700">
                                  <span className={`w-2 h-2 rounded-full ${isOk ? "bg-emerald-500" : "bg-rose-500"}`}></span>
                                  <span>Вызов: <code className="bg-zinc-200 px-1 py-0.5 rounded text-[10px] font-mono text-zinc-950">{tc.toolName}</code></span>
                                </div>
                                <span className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full ${isOk ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                                  {isOk ? "Успешно" : "Ошибка"}
                                </span>
                              </div>
                              <div className="p-2 space-y-1 bg-white">
                                <div className="text-[10.5px] text-zinc-500">
                                  <span className="font-semibold text-zinc-600">Параметры: </span>
                                  <code className="font-mono text-zinc-700 break-all">{JSON.stringify(tc.arguments)}</code>
                                </div>
                                <details className="cursor-pointer">
                                  <summary className="text-[10px] text-[#1b5df7] font-semibold hover:underline outline-hidden">
                                    Показать консольный вывод ({tc.output?.length || 0} симв.)
                                  </summary>
                                  <div className="mt-1 p-2 bg-zinc-950 text-zinc-200 rounded-md font-mono text-[10px] whitespace-pre-wrap overflow-x-auto max-h-48 scrollbar-thin leading-snug">
                                    {tc.output || "[Пустой вывод]"}
                                  </div>
                                </details>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Main content block */}
                    <div className="text-zinc-900 text-sm sm:text-base leading-relaxed break-words select-text pt-0.5">
                      {isUser ? (
                        <div className="space-y-2.5">
                          {msg.audioUrl && (
                            <VoiceMessagePlayer audioUrl={msg.audioUrl} />
                          )}
                          <p className="whitespace-pre-wrap font-sans text-[15px]">{msg.content}</p>
                          
                          {/* Attached files preview list */}
                          {msg.files && msg.files.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-2 select-none">
                              {msg.files.map((file, fIdx) => {
                                const isImg = file.type.startsWith("image/");
                                return (
                                  <div key={fIdx} className="flex items-center gap-2.5 p-2 bg-zinc-50 border border-zinc-200 rounded-xl max-w-[240px] shadow-3xs text-xs animate-fade">
                                    {isImg ? (
                                      <a href={file.base64} target="_blank" rel="noopener noreferrer" className="block shrink-0 cursor-zoom-in">
                                        <img
                                          src={file.base64}
                                          alt={file.name}
                                          className="w-10 h-10 rounded-lg object-cover bg-zinc-100 border border-zinc-150 hover:opacity-95 transition-opacity"
                                          referrerPolicy="no-referrer"
                                        />
                                      </a>
                                    ) : (
                                      <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-150 flex items-center justify-center text-[#1b5df7] shrink-0 font-sans">
                                        <FileText size={18} />
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1 font-sans">
                                      <div className="font-semibold text-zinc-900 truncate leading-snug" title={file.name}>
                                        {file.name}
                                      </div>
                                      <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                                        {file.size ? `${(file.size / 1024).toFixed(1)} КБ` : "файл"}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <MarkdownRenderer content={msg.content} />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* AI active generation state */}
            {isLoading && (
              <div className="flex gap-4 items-start animate-fade pt-2">
                <div className="w-7 sm:w-8 h-7 sm:h-8 rounded-full bg-[#1b5df7] shrink-0 flex items-center justify-center text-white">
                  <Brain size={14} className="text-white shrink-0 animate-scale" />
                </div>
                <div className="min-w-0 flex-1 space-y-3 font-sans">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-900">Ин-Кон</span>
                    <span className="text-[10px] text-zinc-400 animate-pulse font-medium">Думает...</span>
                  </div>

                  {/* Pulsing loading effect */}
                  {deepThink ? (
                    <div className="border-l-2 border-[#1b5df7] bg-blue-50/20 p-2.5 rounded-r-lg inline-flex items-center gap-2 text-xs font-medium text-blue-600 animate-pulse select-none font-sans">
                      <Brain size={14} className="animate-spin text-[#1b5df7]" />
                      <span>Анализ мыслительного процесса (R1)...</span>
                    </div>
                  ) : (
                    <div className="border-l-2 border-emerald-500 bg-emerald-50/30 p-2.5 rounded-r-lg inline-flex items-center gap-2 text-xs font-medium text-emerald-700 animate-pulse select-none font-sans">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                      <span>Суперагент Ин-Кон: выполнение системных инструментов (VPS)...</span>
                    </div>
                  )}

                  <div className="space-y-2 max-w-md animate-pulse pt-1">
                    <div className="h-3 bg-zinc-150 rounded w-full"></div>
                    <div className="h-3 bg-zinc-150 rounded w-5/6"></div>
                    <div className="h-3 bg-zinc-150 rounded w-2/3"></div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Errors Prompts */}
      {errorMsg && (
        <div className="bg-rose-50 border-t border-rose-200 px-4 py-2.5 shrink-0 animate-fade">
          <div className="max-w-2xl mx-auto flex gap-2 items-start text-xs text-rose-800">
            <AlertCircle className="text-rose-600 shrink-0 mt-0.5 font-bold" size={15} />
            <div className="min-w-0 flex-1 font-sans">
              <p className="font-semibold text-rose-950">Приостановлено</p>
              <p className="mt-0.5 font-medium leading-relaxed text-rose-900">
                {errorMsg}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Input Area Container */}
      <footer className="border-t border-[#e8ecf1] p-3 sm:p-4 bg-white z-20 shrink-0 select-none">
        <div className="max-w-3xl mx-auto">
          {/* Voice status error warning if any */}
          {voiceError && (
            <div className="mb-2.5 p-2 py-2.5 px-3.5 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-xs flex justify-between items-center animate-fade font-sans shrink-0 max-w-full">
              <span className="font-semibold text-left leading-relaxed">{voiceError}</span>
              <button
                type="button"
                onClick={() => setVoiceError(null)}
                className="text-[10px] text-amber-500 hover:text-amber-800 font-bold ml-3 cursor-pointer shrink-0"
              >
                Закрыть
              </button>
            </div>
          )}

          {/* Standard DeepSeek Styled Input Area */}
          <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="border border-[#d0d7de] rounded-2xl bg-[#fafafa] focus-within:bg-white focus-within:border-[#1b5df7] transition-all shadow-xs pr-2 py-1.5 relative flex flex-col select-none"
          >
            {/* Drag & Drop Visual Overlay Feed */}
            {isDragging && (
              <div className="absolute inset-0 bg-blue-500/10 border-2 border-dashed border-[#1b5df7] rounded-2xl flex items-center justify-center z-50 pointer-events-none animate-fade">
                <div className="bg-white px-4 py-3 rounded-2xl shadow-lg border border-blue-200 flex items-center gap-2 text-sm font-semibold text-[#1b5df7] font-sans">
                  <Paperclip size={16} className="animate-bounce" />
                  <span>Перетащите файлы сюда, чтобы прикрепить</span>
                </div>
              </div>
            )}

            {isRecording ? (
              /* Active microphone recording status */
              <div className="flex-1 flex items-center justify-between px-3.5 py-2 rounded-xl animate-fade">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 select-none shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600"></span>
                  </span>
                  <span className="text-xs sm:text-sm font-semibold text-rose-700 font-mono select-none">
                    Запись голосового: {formatDuration(recordDuration)}
                  </span>
                  
                  {/* SOUNDWAVE BOUNCING EFFECT */}
                  <div className="flex items-end gap-0.5 h-3 select-none pl-1 shrink-0">
                    <div className="w-0.5 bg-rose-600 rounded-full animate-bounce h-1.5" style={{ animationDuration: "0.6s" }}></div>
                    <div className="w-0.5 bg-rose-600 rounded-full animate-bounce h-3" style={{ animationDuration: "0.4s", animationDelay: "0.15s" }}></div>
                    <div className="w-0.5 bg-rose-600 rounded-full animate-bounce h-2" style={{ animationDuration: "0.5s", animationDelay: "0.07s" }}></div>
                    <div className="w-0.5 bg-rose-600 rounded-full animate-bounce h-1" style={{ animationDuration: "0.3s", animationDelay: "0.2s" }}></div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={cancelRecording}
                    className="p-1.5 text-zinc-450 hover:bg-zinc-150 hover:text-zinc-800 rounded-full transition-all cursor-pointer"
                    title="Удалить запись"
                  >
                    <Trash2 size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="p-1.5 px-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full transition-all cursor-pointer text-xs font-semibold flex items-center gap-1.5"
                    title="Завершить и отправить"
                  >
                    <Square size={10} fill="currentColor" />
                    <span>Отправить</span>
                  </button>
                </div>
              </div>
            ) : isTranscribing ? (
              /* Active audio transcription loading indicator */
              <div className="flex-1 flex items-center justify-between px-3.5 py-3 bg-blue-50/10 rounded-xl animate-fade">
                <div className="flex items-center gap-2.5 min-w-0">
                  <RefreshCw size={14} className="text-[#1b5df7] animate-spin shrink-0" />
                  <span className="text-xs sm:text-sm font-semibold text-zinc-700 font-sans font-sans">Транскрибирую голос через Gemini AI...</span>
                </div>
                <div className="text-[9px] bg-blue-50 text-[#1b5df7] border border-blue-100 px-2.5 py-0.5 rounded-full font-bold animate-pulse select-none uppercase tracking-wider">
                  Секунду
                </div>
              </div>
            ) : (
              /* Standard chat input form */
              <>
                {/* Selected attachments inline preview gallery */}
                {selectedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-2 px-3 border-b border-zinc-200/60 bg-zinc-100/50 rounded-t-2xl">
                    {selectedFiles.map((file, idx) => {
                      const isImg = file.type.startsWith("image/");
                      return (
                        <div key={idx} className="relative group flex items-center gap-2 p-1.5 pr-2.5 bg-white border border-zinc-200 rounded-xl max-w-[200px] shrink-0 shadow-3xs animate-fade">
                          {isImg ? (
                            <img
                              src={file.base64}
                              alt={file.name}
                              className="w-8 h-8 rounded-lg object-cover bg-zinc-100 border border-zinc-150"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-150 flex items-center justify-center text-[#1b5df7] shrink-0 font-sans">
                              <FileText size={15} />
                            </div>
                          )}
                          
                          <div className="min-w-0 flex-1 font-sans font-sans">
                            <div className="text-[11px] font-semibold text-zinc-800 truncate leading-snug">
                              {file.name}
                            </div>
                            <div className="text-[9px] text-zinc-400 font-mono">
                              {file.size ? `${(file.size / 1024).toFixed(1)} КБ` : "файл"}
                            </div>
                          </div>

                          {/* Close/Remove attachment */}
                          <button
                            type="button"
                            onClick={() => handleRemoveFile(idx)}
                            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-zinc-700 hover:bg-zinc-900 border border-white text-white rounded-full flex items-center justify-center cursor-pointer transition-colors shadow-3xs text-[9px]"
                          >
                            <X size={9} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Hidden File Input Selector */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  multiple
                  className="hidden"
                />

                <textarea
                  ref={textareaRef}
                  rows={3}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isLoading ? "Дождитесь ответа..." : "Спросите о чем угодно... (Ctrl+Enter)"}
                  disabled={isLoading}
                  className="flex-1 max-h-44 px-3 py-2 text-zinc-900 text-sm placeholder-zinc-400 bg-transparent border-0 focus:outline-hidden focus:ring-0 resize-none font-sans leading-relaxed text-left min-h-[72px]"
                />

                {/* Lower dynamic toolbar (Automated status) */}
                <div className="pt-2 px-2.5 flex items-center justify-between border-t border-zinc-150/40 shrink-0">
                  <div className="flex items-center gap-2 text-zinc-400 select-none">
                    <Sparkles size={11} className="text-[#1b5df7] animate-pulse" />
                    <span className="text-[11px] font-sans font-medium text-zinc-400">
                      Суперагент автоматически подберет оптимальный режим (Анализ / Команды VPS / Сеть)
                    </span>
                  </div>

                  {/* Send mechanisms on far right */}
                  <div className="flex items-center gap-1.5">
                    {/* Attachment Paperclip button */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                      className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 rounded-full transition-all cursor-pointer shrink-0"
                      title="Прикрепить файлы или изображения"
                    >
                      <Paperclip size={14} />
                    </button>

                    {/* Recording button selector */}
                    <button
                      type="button"
                      onClick={startRecording}
                      disabled={isLoading}
                      className="p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 rounded-full transition-all cursor-pointer shrink-0"
                      title="Записать голосовое сообщение"
                    >
                      <Mic size={14} />
                    </button>

                    <button
                      type="button"
                      onClick={handleSendText}
                      disabled={isLoading || (!input.trim() && selectedFiles.length === 0)}
                      className="p-1.5 bg-[#1b5df7] text-white rounded-full hover:bg-blue-700 disabled:bg-zinc-150 disabled:text-zinc-400 transition-all cursor-pointer shadow-3xs"
                      title="Отправить (Enter)"
                    >
                      <Send size={13} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Prompt sub-hint info */}
        </div>
      </footer>
    </div>
  );
};
