import React from "react";
import { MessageSquare, Plus, Trash2, X, MessageSquarePlus, Brain } from "lucide-react";
import { ChatSession, LearnedLesson } from "../types";

interface SidebarProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
  lessons: LearnedLesson[];
  onDeleteLesson: (id: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  isOpen,
  onClose,
  lessons,
  onDeleteLesson,
}) => {

  return (
    <>
      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/15 backdrop-blur-xs z-30 lg:hidden transition-opacity"
          onClick={onClose}
        />
      )}

      {/* Main Sidebar (DeepSeek theme is ultra-clean white/light gray background) */}
      <aside
        className={`fixed inset-y-0 left-0 w-68 bg-[#f6f8fa] border-r border-[#e8ecf1] flex flex-col z-40 transition-transform duration-200 lg:static lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header Branding */}
        <div className="h-14 flex items-center justify-between px-4 bg-white border-[#e8ecf1] border-b shrink-0">
          <div className="flex items-center gap-2">
            {/* Elegant high-tech round logo badge for In-Con */}
            <div className="w-7 h-7 rounded-full bg-[#1b5df7] flex items-center justify-center select-none shadow-xs">
              <span className="text-white font-black text-xs tracking-tighter">I</span>
            </div>
            <div>
              <h1 className="font-semibold text-zinc-900 text-xs sm:text-sm tracking-tight flex items-center gap-1.5">
                <span>In-Con</span>
                <span className="text-[10px] font-medium text-[#1b5df7] bg-blue-50/50 border border-blue-150 px-1 py-0.2 rounded-md font-sans">
                  SuperAgent
                </span>
              </h1>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-md text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Action button */}
        <div className="p-3 bg-white border-b border-[#e8ecf1] shrink-0">
          <button
            onClick={() => {
              onNewSession();
              onClose();
            }}
            className="w-full flex items-center justify-between gap-2 bg-[#f4f7fc] hover:bg-[#ebf1fc] text-[#1b5df7] font-medium text-xs py-2 px-3 rounded-lg border border-[#d8e3fd] transition-all cursor-pointer group"
          >
            <span className="flex items-center gap-1.5 font-semibold text-[#1b5df7]">
              <MessageSquarePlus size={14} />
              Новый чат
            </span>
            <span className="text-[10px] font-mono border border-[#d8e3fd] px-1 py-0.2 rounded text-zinc-400 font-normal bg-white">
              Ctrl+I
            </span>
          </button>
        </div>

        {/* Scrollable conversation logs */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3.5 scrollbar-thin select-none">
          <div className="space-y-1">
            <div className="px-2 pb-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              История чатов
            </div>
            {sessions.length === 0 ? (
              <div className="text-center py-8 px-4 select-none">
                <p className="text-xs text-zinc-400">Нет диалогов</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  return (
                    <div
                      key={session.id}
                      className={`group relative flex items-center justify-between rounded-lg p-2 transition-all text-xs border ${
                        isActive
                          ? "bg-white border-[#d8e3fd] shadow-3xs text-[#1b5df7] font-medium"
                          : "border-transparent text-zinc-650 hover:bg-[#eaeef3] hover:text-zinc-950"
                      }`}
                    >
                      <button
                        onClick={() => {
                          onSelectSession(session.id);
                          onClose();
                        }}
                        className="flex-1 text-left min-w-0 pr-1 truncate font-medium cursor-pointer"
                      >
                        {session.title || "Новый диалог"}
                      </button>
                      <button
                        onClick={() => onDeleteSession(session.id)}
                        className="text-zinc-400 hover:text-rose-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-100 cursor-pointer shrink-0"
                        title="Удалить диалог"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Lessons Self-Learning Panel */}
          <div className="pt-4 border-t border-[#e8ecf1] mt-2 select-text">
            <div className="px-2 pb-1.5 flex items-center justify-between select-none">
              <span className="text-[10px] font-bold text-[#1b5df7] uppercase tracking-wider flex items-center gap-1">
                <Brain size={12} className="text-[#1b5df7] animate-pulse" />
                Опыт Самообучения ({lessons.length})
              </span>
            </div>
            
            {lessons.length === 0 ? (
              <div className="px-3 py-4 text-center border border-dashed border-zinc-200 rounded-lg mx-2 bg-zinc-50/50 select-none">
                <p className="text-[10px] text-zinc-400">Нет выученных уроков. Агент учится в фоновом режиме на реальных задачах.</p>
              </div>
            ) : (
              <div className="px-2 space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
                {lessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className="p-2 border border-[#e8ecf1] rounded-lg bg-white relative group/lesson transition-all hover:border-[#1b5df7]/30 shadow-[0_1px_3px_rgba(0,0,0,0.02)]"
                  >
                    <div className="flex items-center justify-between select-none">
                      <span className="text-[8px] font-mono font-semibold px-1 py-0.2 bg-blue-50/50 border border-blue-150 rounded text-[#1b5df7]">
                        {lesson.category}
                      </span>
                      <button
                        onClick={() => onDeleteLesson(lesson.id)}
                        className="text-zinc-300 hover:text-rose-600 transition-colors p-0.5 rounded cursor-pointer opacity-0 group-hover/lesson:opacity-100 shrink-0"
                        title="Удалить"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                    <div className="font-semibold text-[10px] text-zinc-800 mt-1 line-clamp-1">
                      {lesson.title}
                    </div>
                    <div className="text-[9px] text-zinc-500 mt-0.5 leading-snug line-clamp-2" title={lesson.details}>
                      {lesson.details}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer info (In-Con branding footer) */}
        <div className="p-3 border-t border-[#e8ecf1] bg-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-zinc-200 border border-zinc-300 flex items-center justify-center text-[10px] uppercase font-bold text-zinc-700">
              V
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-zinc-800 truncate leading-none">
                vb.incon@gmail.com
              </p>
              <span className="text-[9px] font-medium text-[#1b5df7] bg-blue-50/50 px-2 py-0.5 border border-blue-100 rounded inline-block mt-1">
                In-Con Workspace
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
