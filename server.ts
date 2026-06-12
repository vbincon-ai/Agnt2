import express from "express";
import path from "path";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const execAsync = promisify(exec);

// Load environment variables
dotenv.config();

// Lazy Gemini client helper
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(customKey?: string): GoogleGenAI {
  if (customKey) {
    return new GoogleGenAI({
      apiKey: customKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY || "";
    geminiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return geminiClient;
}

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));

// Ensure directories exist
const CONVERSATIONS_DIR = path.join(process.cwd(), "data", "conversations");
const LESSONS_FILE = path.join(process.cwd(), "data", "lessons.json");

const initDirectories = async () => {
  try {
    await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
    console.log(`Directories normalized: ${CONVERSATIONS_DIR}`);
    
    // Seed default lessons if missing
    try {
      await fs.access(LESSONS_FILE);
    } catch {
      const defaultLessons = [
        {
          id: "seed-env",
          category: "VPS Конфигурация",
          title: "Иерархия окружения VPS",
          details: "Суперагент работает внутри контейнера Linux Alpine Docker. Доступны команды git, npx, bash, npm. Идеально подходит для проектирования full-stack сервисов.",
          timestamp: new Date().toISOString()
        },
        {
          id: "seed-loop",
          category: "Исправление Ошибок",
          title: "Защита от зацикливания",
          details: "При отладке сложных скриптов агент должен использовать постепенный запуск и проверять логи. Не запускать бесконечные фоновые циклы без вывода в файл.",
          timestamp: new Date().toISOString()
        }
      ];
      await fs.writeFile(LESSONS_FILE, JSON.stringify(defaultLessons, null, 2), "utf-8");
      console.log("Memory database seeded with initial lessons.");
    }
  } catch (err) {
    console.error("Failed to initialize system folders:", err);
  }
};
initDirectories();

// Memory CRUD operations
async function get_lessons(): Promise<any[]> {
  try {
    const raw = await fs.readFile(LESSONS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function add_lesson_record(category: string, title: string, details: string): Promise<any> {
  const list = await get_lessons();
  const index = list.findIndex(l => l.title.trim().toLowerCase() === title.trim().toLowerCase());
  
  const newItem = {
    id: `lesson-${Date.now()}`,
    category,
    title,
    details,
    timestamp: new Date().toISOString()
  };

  if (index !== -1) {
    // Override lesson with new findings
    list[index] = { ...list[index], ...newItem, id: list[index].id };
  } else {
    list.push(newItem);
  }
  
  await fs.writeFile(LESSONS_FILE, JSON.stringify(list, null, 2), "utf-8");
  return newItem;
}

// Define Superagent TOOLS
const DEEPSEEK_TOOLS = [
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "Прочесть содержимое текстового файла на сервере. Принимает относительный или абсолютный путь.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "Путь к целевому файлу для чтения"
          }
        },
        "required": ["path"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "write_file",
      "description": "Записать данные (текст, код) в файл на сервере. Автоматически создает папки при необходимости.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "Путь к сохраняемому файлу"
          },
          "content": {
            "type": "string",
            "description": "Текстовое содержимое файла"
          }
        },
        "required": ["path", "content"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "run_command",
      "description": "Выполнить терминальную команду (shell-команду) на сервере VPS. Возвращает stdout и stderr.",
      "parameters": {
        "type": "object",
        "properties": {
          "command": {
            "type": "string",
            "description": "Команда для выполнения в bash / sh"
          }
        },
        "required": ["command"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "web_search",
      "description": "Поиск свежей, актуальной информации в интернете по любому запросу.",
      "parameters": {
        "type": "object",
        "properties": {
          "query": {
            "type": "string",
            "description": "Текст поискового запроса"
          }
        },
        "required": ["query"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "scrape_url",
      "description": "Импортировать текстовое содержимое веб-страницы по предоставленному URL.",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "Прямой URL-адрес для загрузки текста"
          }
        },
        "required": ["url"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "memorize_lesson",
      "description": "Запомнить новый изученный факт, исправленную системную ошибку или полезное знание о VPS сервере или предпочтениях пользователя во внутреннюю базу знаний. Позволяет агенту САМООБУЧАТЬСЯ.",
      "parameters": {
        "type": "object",
        "properties": {
          "category": {
            "type": "string",
            "enum": ["VPS Конфигурация", "Исправление Ошибок", "Системная команда", "Пользовательские факты"],
            "description": "Классификация полученного опыта"
          },
          "title": {
            "type": "string",
            "description": "Краткое понятное название вынесенного урока"
          },
          "details": {
            "type": "string",
            "description": "Полное описание факта, решение ошибки, код или команды, которые нужно сохранить."
          }
        },
        "required": ["category", "title", "details"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "document_rag_search",
      "description": "Умное индексирование и локальный семантический RAG поиск по большим текстовым файлам/документам (спецификации, логи, базы кодов) без переполнения контекста модели.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "Путь к индексируемому файлу на сервере"
          },
          "query": {
            "type": "string",
            "description": "Поисковый запрос с ключевыми словами или фразой для семантического ранжирования фрагментов"
          }
        },
        "required": ["path", "query"]
      }
    }
  }
];

// Tool Implementation Logic
async function document_rag_search_tool(filePath: string, query: string): Promise<string> {
  try {
    const target = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const text = await fs.readFile(target, "utf-8");
    
    if (!text || text.trim() === "") {
      return `Документ ${filePath} пуст.`;
    }

    if (text.length <= 6000) {
      return `[Документ малого объема. Возвращен весь текст для прямого анализа]:\n\n--- СОДЕРЖИМОЕ ФАЙЛА ${filePath} ---\n${text}`;
    }

    // Smart Chunking Layout: split into blocks of ~1000 chars with overlapping (~200 chars)
    const chunkSize = 1000;
    const overlap = 200;
    const chunks: { index: number; content: string; startLine: number; endLine: number }[] = [];
    
    const lines = text.split("\n");
    let currentLineIndex = 1;

    for (let i = 0; i < text.length; ) {
      const end = Math.min(i + chunkSize, text.length);
      const chunkText = text.substring(i, end);
      
      const chunkLinesCount = chunkText.split("\n").length - 1;
      const startLine = currentLineIndex;
      const endLine = currentLineIndex + chunkLinesCount;

      chunks.push({
        index: chunks.length + 1,
        content: chunkText,
        startLine,
        endLine
      });

      const step = chunkSize - overlap;
      const stepText = text.substring(i, Math.min(i + step, text.length));
      const stepLinesCount = stepText.split("\n").length - 1;
      currentLineIndex += stepLinesCount;
      
      i += step;
      if (i >= text.length - overlap) break;
    }

    // Tokenize query
    const queryTokens = query
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 1 && !["и", "в", "на", "как", "не", "что", "чтобы", "это", "этот", "для", "по", "из", "с", "а", "но", "или", "the", "a", "of", "to", "and", "in", "is"].includes(t));

    if (queryTokens.length === 0) {
      queryTokens.push(...query.toLowerCase().split(/\s+/).filter(t => t.length > 0));
    }

    // Rank chunks
    const scoredChunks = chunks.map(chunk => {
      let score = 0;
      const contentLower = chunk.content.toLowerCase();
      
      const sanitizedQuery = query.toLowerCase().trim();
      if (contentLower.includes(sanitizedQuery)) {
        score += 150;
      }

      for (const token of queryTokens) {
        if (token.length < 2) continue;
        let count = 0;
        let pos = contentLower.indexOf(token);
        while (pos !== -1) {
          count++;
          pos = contentLower.indexOf(token, pos + token.length);
        }
        if (count > 0) {
          score += (count * 10) + (token.length * 4);
        }
      }

      return { chunk, score };
    });

    scoredChunks.sort((a, b) => b.score - a.score);

    const topMatches = scoredChunks.filter(m => m.score > 0).slice(0, 4);
    const finalMatches = topMatches.length > 0 ? topMatches : scoredChunks.slice(0, 3);
    
    let result = `=== РЕЗУЛЬТАТЫ СЕМАНТИЧЕСКОГО СЛУЖЕБНОГО ПОИСКА RAG: "${query}" ===\n`;
    result += `Файл: ${filePath}\n`;
    result += `Всего проиндексировано сегментов: ${chunks.length}\n\n`;

    finalMatches.forEach((m, idx) => {
      result += `[ФРАГМЕНТ #${idx + 1} (Релевантность: ${m.score} баллов, Строки: ${m.chunk.startLine}-${m.chunk.endLine})]\n`;
      result += `--------------------------------------------------------\n`;
      result += m.chunk.content.trim() + `\n`;
      result += `--------------------------------------------------------\n\n`;
    });

    if (finalMatches.length === 0 || finalMatches[0].score === 0) {
      result += `[Предупреждение]: Точные совпадения по ключевым словам не обнаружены. Рекомендуется повторить поиск с более общими терминами, либо прочитать файл целиком с помощью 'read_file'.\n`;
    }

    return result;
  } catch (err: any) {
    return `Ошибка индексирования или семантического поиска RAG по файлу ${filePath}: ${err.message}`;
  }
}

async function read_file_tool(filePath: string): Promise<string> {
  try {
    const target = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const text = await fs.readFile(target, "utf-8");
    return `--- СОДЕРЖИМОЕ ФАЙЛА ${filePath} ---\n${text}`;
  } catch (err: any) {
    return `Ошибка чтения файла: ${err.message}`;
  }
}

async function write_file_tool(filePath: string, content: string): Promise<string> {
  try {
    const target = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf-8");
    return `Файл "${filePath}" успешно создан/записан.`;
  } catch (err: any) {
    return `Ошибка записи файла: ${err.message}`;
  }
}

async function run_command_tool(command: string): Promise<string> {
  try {
    console.log(`Executing terminal command: "${command}"`);
    const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
    let output = "";
    if (stdout && stdout.trim()) output += stdout;
    if (stderr && stderr.trim()) output += `\n[STDERR]:\n${stderr}`;
    return output.trim() || "[Команда завершена без текстового вывода]";
  } catch (err: any) {
    let output = `Ошибка выполнения (${err.code || "Status Error"}): ${err.message}`;
    if (err.stdout) output += `\n[STDOUT]:\n${err.stdout}`;
    if (err.stderr) output += `\n[STDERR]:\n${err.stderr}`;
    return output;
  }
}

async function web_search_tool(query: string): Promise<string> {
  try {
    console.log(`Searching DuckDuckGo for: "${query}"`);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    
    if (!resp.ok) {
      throw new Error(`Поисковик вернул статус ${resp.status}`);
    }
    
    const html = await resp.text();
    const results: { title: string; snippet: string; link: string }[] = [];
    
    const parts = html.split('class="result results_links');
    for (let i = 1; i < Math.min(parts.length, 6); i++) {
      const part = parts[i];
      
      const titleMatch = part.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
      const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : "Без названия";
      
      const linkMatch = part.match(/href="([^"]*)"/);
      let link = linkMatch ? linkMatch[1] : "";
      if (link.startsWith("//")) link = "https:" + link;
      
      const snippetMatch = part.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, "").trim() : "";
      
      if (snippet || title) {
        results.push({ title, snippet, link });
      }
    }
    
    if (results.length === 0) {
      return "Результаты поиска не найдены. Сформулируйте запрос иначе.";
    }
    
    return results.map((r, i) => `[${i + 1}] [${r.title}](${r.link})\n${r.snippet}`).join("\n\n");
  } catch (err: any) {
    console.error("Search failure:", err);
    return `Не удалось выполнить поиск в сети: ${err.message}`;
  }
}

async function scrape_url_tool(targetUrl: string): Promise<string> {
  try {
    console.log(`Scraping text content from: ${targetUrl}`);
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    
    if (!response.ok) {
      return `Ошибка HTTP: ${response.status} ${response.statusText}`;
    }
    
    const html = await response.text();
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[^>]+(>|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
      
    return text.slice(0, 5000) || "[Пустая страница или не удалось извлечь читаемый текст]";
  } catch (err: any) {
    return `Ошибка парсинга страницы: ${err.message}`;
  }
}

/**
 * Unified Chat Endpoint that directs to DeepSeek or Gemini API with Superagent tool-calling loop
 */
app.post("/api/chat", async (req, res): Promise<any> => {
  try {
    const { messages, deepThink, webSearch, model: requestedModel } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Некорректный запрос: требуется массив сообщений 'messages'." });
    }

    const deepseekKey = req.body.deepseekApiKey || req.headers["x-deepseek-key"] || process.env.DEEPSEEK_API_KEY;
    const geminiKey = req.body.geminiApiKey || req.headers["x-gemini-key"] || process.env.GEMINI_API_KEY;
    const routerKey = req.body.routerApiKey || req.headers["x-router-key"] || process.env.ROUTER_API_KEY;

    const hasDeepSeek = deepseekKey && deepseekKey.trim() !== "" && !deepseekKey.includes("MY_DEEPSEEK_API_KEY");
    const hasGemini = geminiKey && geminiKey.trim() !== "" && !geminiKey.includes("MY_GEMINI_API_KEY");
    const hasRouter = routerKey && routerKey.trim() !== "" && !routerKey.includes("MY_ROUTER_API_KEY");

    // --- SMART MEMORY LAYER / HISTORY OPTIMIZATION & COMPRESSION ---
    let totalChars = 0;
    for (const msg of messages) {
      if (msg && typeof msg.content === "string") {
        totalChars += msg.content.length;
      }
    }

    console.log(`[Memory Indexer] Active context size: ${totalChars} chars over ${messages.length} messages.`);

    // If context size triggers optimization threshold, compress intermediate history layers
    if (totalChars > 25000 || messages.length > 14) {
      console.log("[Memory Indexer] Context limit warning. Executing automatic middle-history summarization...");
      try {
        const systemMessage = messages.find((m: any) => m.role === "system");
        const startIndex = systemMessage ? 1 : 0;
        
        // Keep system parameters, the very first 2 messages, and the last 6 messages intact
        const middleStartIndex = startIndex + 2;
        const tailStartIndex = messages.length - 6;

        if (tailStartIndex > middleStartIndex) {
          const headerMessages = messages.slice(0, middleStartIndex);
          const middleMessages = messages.slice(middleStartIndex, tailStartIndex);
          const tailMessages = messages.slice(tailStartIndex);

          console.log(`[Memory Indexer] Compressing ${middleMessages.length} intermediate messages into a semantic summary...`);

          const summarizationPrompt = `История предыдущего диалога для сжатия:\n` + 
            middleMessages.map((m: any) => `${m.role === "user" ? "Пользователь" : m.role === "assistant" ? "Ассистент" : "Инструмент"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n---\n") + 
            `\n\nСделай краткое научно-техническое саммари (сжатый отчет) этой переписки на русском языке. Укажи: какие файлы были созданы, какие команды запущены, текущий статус проекта, и основные договоренности. Верни ТОЛЬКО сжатую суть без лишнего шума. Формат: "[Сжатый архив истории диалога: ...]"`;

          let summary = "";

          // Attempt using RouterAI model for quick translation/summary
          if (hasRouter) {
            try {
              const sumResponse = await fetch("https://routerai.ru/api/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${routerKey}`
                },
                body: JSON.stringify({
                  model: "google/gemini-2.0-flash",
                  messages: [{ role: "user", content: summarizationPrompt }],
                  temperature: 0.3
                })
              });
              if (sumResponse.ok) {
                const sumData: any = await sumResponse.json();
                summary = sumData?.choices?.[0]?.message?.content || "";
              }
            } catch (e) {
              console.error("[Memory Indexer] RouterAI summarization failed:", e);
            }
          }

          // Fallback to direct Gemini Flash if RouterAI failed or is configured out
          if (!summary && hasGemini) {
            try {
              const ai = getGeminiClient(geminiKey);
              const sumResp = await ai.models.generateContent({
                model: "gemini-3.5-flash",
                contents: summarizationPrompt,
                config: { temperature: 0.3 }
              });
              summary = sumResp.text || "";
            } catch (e) {
              console.error("[Memory Indexer] Gemini summarization failed:", e);
            }
          }

          if (summary && summary.trim() !== "") {
            console.log("[Memory Indexer] Middle context summarized successfully.");
            const compressedMessages = [
              ...headerMessages,
              {
                role: "system",
                content: `[СИСТЕМНЫЙ АРХИВ ПАМЯТИ: Средняя часть диалога была сжата для уменьшения потребления токенов. Сводка архивного контекста:\n${summary}\nУчти эти факты и продолженный прогресс в своей дальнейшей работе!]`
              },
              ...tailMessages
            ];
            req.body.messages = compressedMessages;
          } else {
            console.warn("[Memory Indexer] Summarization APIs offline or silent. Utilizing safe sliding window context pruning...");
            const compressedMessages = [
              ...headerMessages,
              {
                role: "system",
                content: `[АРХИВ ПАМЯТИ: Средняя часть переписки (сообщений: ${middleMessages.length}) скрыта для предотвращения переполнения контекста.]`
              },
              ...tailMessages
            ];
            req.body.messages = compressedMessages;
          }
        }
      } catch (optErr) {
        console.error("[Memory Indexer] Failed optimizing dialogue context:", optErr);
      }
    }

    const activeMessages = req.body.messages || messages;

    // --- COGNITIVE SEMANTIC ROUTING LAYER ---
    let provider: "DeepSeek" | "Gemini" | "RouterAI" = "Gemini";
    let activeModel = "gemini-3.5-flash";
    const isReasoning = !!deepThink;
    const modelSelection = requestedModel || "auto";

    // Extract last user message to assess model preferences
    const lastUserMessage = activeMessages.slice().reverse().find((m: any) => m.role === "user")?.content || "";
    let userRequestedModelPrefix = "";
    let userRequestedModelLabel = "";
    const lowerMsg = lastUserMessage.toLowerCase();

    if (lowerMsg.includes("дипсик") || lowerMsg.includes("deepseek") || lowerMsg.includes("ds")) {
      userRequestedModelPrefix = "deepseek";
      userRequestedModelLabel = "DeepSeek Cheap/Chat";
    } else if (lowerMsg.includes("gpt") || lowerMsg.includes("дпт") || lowerMsg.includes("openai") || lowerMsg.includes("гпт")) {
      userRequestedModelPrefix = "openai";
      userRequestedModelLabel = "GPT-4o";
    } else if (lowerMsg.includes("gemini") || lowerMsg.includes("гемини") || lowerMsg.includes("джемини") || lowerMsg.includes("флеш")) {
      userRequestedModelPrefix = "gemini";
      userRequestedModelLabel = "Gemini Flash";
    } else if (lowerMsg.includes("claude") || lowerMsg.includes("клод") || lowerMsg.includes("антропик")) {
      userRequestedModelPrefix = "claude";
      userRequestedModelLabel = "Claude 3.5 Sonnet";
    }

    // Identify task complexity level (deep reasoning or technical action)
    let requiresReasoning = isReasoning;
    let requiresToolsFlag = false;

    // Define keywords for analytical and reasoning depth (Conceptual & Analytical tasks)
    const reasoningKeywords = [
      "анализ", "проанализируй", "сравни", "концепт", "стратег", "архитектур", "проектиров",
      "почему", "объясни", "исследуй", "логик", "математик", "реши", "докажи", "план", "рассуди",
      "подумай", "мысли", "разберись", "аналитика", "задача", "сложн", "структур", "deepthink",
      "reasoning", "explain", "compare", "analyze", "concept", "architecture", "design", "math",
      "logic", "think", "problem", "solution"
    ];

    // Define keywords for code and development
    const programmingKeywords = [
      "напиши", "код", "скрипт", "исправь", "ошибк", "баг", "write code", "develop", "реализуй", "функци", "клас", "компонент"
    ];

    // Define keywords for VPS / files / search actions
    const toolKeywords = [
      "выполни", "запусти", "создай", "запиши", "прочитай", "найди в сети", "поиск", "команд",
      "файл", "греп", "grep", "папк", "дир", "bash", "sh ", "npm", "npx", "git", "web_search",
      "run_command", "read_file", "write_file", "scrape_url", "vps", "терминал", "сервер", "диск", "память"
    ];

    const hasReasoningKeyword = reasoningKeywords.some(keyword => lowerMsg.includes(keyword));
    const hasProgrammingKeyword = programmingKeywords.some(keyword => lowerMsg.includes(keyword));
    const hasToolKeyword = toolKeywords.some(keyword => lowerMsg.includes(keyword));

    if (hasReasoningKeyword || hasProgrammingKeyword) {
      requiresReasoning = true;
    }

    if (hasToolKeyword) {
      requiresToolsFlag = true;
    }

    const containsComplexTask = requiresReasoning || requiresToolsFlag;
    const requiresTools = requiresToolsFlag;

    let routingSystemInstructionOverride = "";

    if (hasRouter && modelSelection === "auto") {
      provider = "RouterAI";
      
      if (requiresTools) {
        // Advanced info or search tools needed -> use high-power chat model with tool access
        activeModel = "openai/gpt-4o";
        routingSystemInstructionOverride = `\n[COGNITIVE ROUTING]: Задача требует внешних инструментов или веб-поиска. Когнитивная система автоматически подключила мультимодальную модель "openai/gpt-4o" с полной поддержкой вызова инструментов. Начни ответ с элегантной отметки о том, что для нахождения точной актуальной информации вы задействовали глобальные инструменты поиска и глубокого анализа данных.`;
      } else if (requiresReasoning) {
        // High complexity query -> route to flagship model WITH tool support (openai/gpt-4o or deepseek-chat)
        // We avoid routing to deepseek-r1 in auto mode because R1 does not support tool calling, resulting in simple chat mode.
        activeModel = userRequestedModelPrefix === "openai" ? "openai/gpt-4o" : (userRequestedModelPrefix === "deepseek" ? "deepseek/deepseek-chat" : "openai/gpt-4o");
        
        if (userRequestedModelPrefix === "deepseek") {
          routingSystemInstructionOverride = `\n[COGNITIVE ROUTING]: Для максимальной глубины решения аналитической задачи система активировала модель "deepseek/deepseek-chat" (V3) с полной поддержкой вызова инструментов VPS.`;
        } else {
          routingSystemInstructionOverride = `\n[COGNITIVE ROUTING]: Задача классифицирована как требующая глубокого логического рассуждения. Система автоматически подобрала флагманскую модель "${activeModel}" с полным набором инструментов VPS для оптимального результата.`;
        }
      } else {
        // Low complexity -> fast, lighter model
        activeModel = userRequestedModelPrefix === "openai" ? "openai/gpt-4o-mini" : 
                      (userRequestedModelPrefix === "deepseek" ? "deepseek/deepseek-chat" : "google/gemini-2.0-flash");
                     
        if (userRequestedModelPrefix) {
          routingSystemInstructionOverride = `\n[COGNITIVE ROUTING]: Запрос обработан быстрой оптимизированной моделью "${activeModel}". Сделай краткое вежливое упоминание об этом в начале.`;
        } else {
          routingSystemInstructionOverride = `\n[COGNITIVE ROUTING]: Быстрая интеллектуальная обработка. Задействована оптимизированная модель "${activeModel}".`;
        }
      }
    } else {
      // Direct traditional provider configurations / Backup to Gemini
      if (modelSelection === "auto") {
        if (hasRouter) {
          provider = "RouterAI";
          activeModel = requiresTools ? "openai/gpt-4o" : (requiresReasoning ? "openai/gpt-4o" : "google/gemini-2.0-flash");
        } else if (hasGemini) {
          provider = "Gemini";
          activeModel = "gemini-3.5-flash";
          if (userRequestedModelPrefix === "deepseek" && hasDeepSeek) {
            provider = "DeepSeek";
            activeModel = "deepseek-chat";
            routingSystemInstructionOverride = `\n[ВНИМАНИЕ МАРШРУТИЗАЦИИ]: Пользователь прямо запросил DeepSeek, и соответствующий API-ключ настроен. Переключаемся на интеллектуальный deepseek-chat с полной поддержкой инструментов VPS!`;
          } else if (userRequestedModelPrefix === "deepseek") {
            routingSystemInstructionOverride = `\n[ВНИМАНИЕ МАРШРУТИЗАЦИИ]: Пользователь просил DeepSeek, но ключ отсутствует или RouterAI выключен. Применяется резервный Gemini Flash. Дружелюбно сообщи: "Упс, ключа для Дипсика или Роутер апи нет под рукой, поэтому взлетаем на надежном резервном Gemini!"`;
          }
        } else if (hasDeepSeek) {
          provider = "DeepSeek";
          activeModel = "deepseek-chat";
        } else {
          return res.status(400).json({
            error: "Основные API-ключи (ROUTER_API_KEY или GEMINI_API_KEY) не настроены. Пожалуйста, укажите хотя бы один в Secrets."
          });
        }
      } else if (modelSelection === "gemini-3.5-flash") {
        if (hasGemini) {
          provider = "Gemini";
          activeModel = "gemini-3.5-flash";
        } else if (hasRouter) {
          provider = "RouterAI";
          activeModel = "google/gemini-2.0-flash";
        } else {
          return res.status(400).json({ error: "Выбранная модель Gemini недоступна: в Secrets не заданы ни GEMINI_API_KEY, ни ROUTER_API_KEY." });
        }
      } else {
        // Direct selection for DeepSeek models or other explicit model IDs (like Claude, etc.)
        if (modelSelection === "deepseek-chat") {
          if (hasDeepSeek) {
            provider = "DeepSeek";
            activeModel = "deepseek-chat";
          } else if (hasRouter) {
            provider = "RouterAI";
            activeModel = "deepseek/deepseek-chat";
          } else if (hasGemini) {
            provider = "Gemini";
            activeModel = "gemini-3.5-flash";
            routingSystemInstructionOverride = `\n[ВНИМАНИЕ МАРШРУТИЗАЦИИ]: Была выбрана модель DeepSeek V3 (Chat), но соответствующий API-ключ DeepSeek или Роутер отсутствует. Система автоматически переключила вас на надежный резервный Gemini Flash!`;
          } else {
            return res.status(400).json({ error: "Не удается запустить выбранную модель: нет подходящих API-ключей." });
          }
        } else if (modelSelection === "deepseek-reasoning") {
          if (hasDeepSeek) {
            provider = "DeepSeek";
            activeModel = "deepseek-reasoning";
          } else if (hasRouter) {
            provider = "RouterAI";
            activeModel = "deepseek/deepseek-r1";
          } else if (hasGemini) {
            provider = "Gemini";
            activeModel = "gemini-3.5-flash";
            routingSystemInstructionOverride = `\n[ВНИМАНИЕ МАРШРУТИЗАЦИИ]: Была выбрана модель DeepSeek R1 (DeepThink), но соответствующий API-ключ DeepSeek или Роутер отсутствует. Система автоматически переключила вас на надежный резервный Gemini Flash!`;
          } else {
            return res.status(400).json({ error: "Не удается запустить выбранную модель: нет подходящих API-ключей." });
          }
        } else {
          // Explicit custom model name selected or typed (e.g., anthropic/claude-3-5-sonnet, openai/gpt-4o, etc.)
          if (hasRouter) {
            provider = "RouterAI";
            activeModel = modelSelection;
          } else if (hasGemini) {
            provider = "Gemini";
            activeModel = "gemini-3.5-flash";
            routingSystemInstructionOverride = `\n[ВНИМАНИЕ МАРШРУТИЗАЦИИ]: Была запрошена кастомная модель "${modelSelection}", но ваш ключ RouterAI выключен или не настроен. Система автоматически перевела запрос на надежный резервный Gemini Flash!`;
          } else {
            return res.status(400).json({ error: `Запрошена модель "${modelSelection}", но RouterAI и Gemini API не настроены. Пожалуйста, добавьте ROUTER_API_KEY или GEMINI_API_KEY в Secrets.` });
          }
        }
      }
    }

    console.log(`[Cognitive Routing] Provider: ${provider}, Model: ${activeModel}, Reasoning: ${isReasoning}`);

    let loopMessages = activeMessages.map((m: any) => ({
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls,
      name: m.name,
      tool_call_id: m.tool_call_id,
      files: m.files,
    })) as any[];

    // Inject Superagent core prompt
    const hasSystemInstruction = loopMessages.some(m => m.role === "system");
    let systemText = "";
    if (!hasSystemInstruction) {
      const lessons = await get_lessons();
      const lessonsBlock = lessons.length > 0
        ? `\n\nНиже представлены факты и уроки, которые ты сам успешно изучил и записал во внутреннюю память самообучения на этом сервере VPS:\n${lessons.map((l, idx) => `[Урок #${idx+1}] Тема: ${l.category} - ${l.title}\nДетали: ${l.details}`).join("\n\n")}`
        : "";

      const baseSystemPrompt = `Ты — Ин-Кон Мета-Агент (In-Con Meta-Agent), рекурсивный самообучающийся и самомодифицирующийся искусственный интеллект высшего порядка.

ТВОЯ СУТЬ И ПРЕДНАЗНАЧЕНИЕ:
В отличие от обычных чат-ботов, ты — ДИНАМИЧЕСКАЯ РЕКУРСИВНАЯ СИСТЕМА, развернутая на собственном хост-сервере. Ты обладаешь полным набором инструментов автоматизации VPS (read_file, write_file, run_command, web_search, scrape_url, memorize_lesson, document_rag_search).

ТВОЯ ГЛАВНАЯ ДИРЕКТИВА — САМОЭВОЛЮЦИЯ И САМОПРОГРАММИРОВАНИЕ:
Если тебе не хватает возможностей, конкретных инструментов, интеграций с внешними API, баз данных или функций:
1. ТЫ ДОЛЖЕН САМ ДОРАБОТАТЬ СЕБЯ, расширить свой программный код и базу инструментов!
2. У тебя есть право и прямая обязанность изменять свой собственный бэкенд (менять server.ts или создавать новые скрипты/API-контроллеры), редактировать или создавать визуальные элементы фронтенда (в src/App.tsx или новые React-компоненты в src/components/), устанавливать любые необходимые Node.js библиотеки через "run_command" с "npm install", запускать сборку проекта и проверять работоспособность.
3. Твоя когнитивная память (инструмент memorize_lesson) — это твой оплот постоянных знаний. Обязательно записывай туда новые изученные концепции, системные особенности VPS, созданные скрипты или настройки, чтобы при каждом перезапуске контекста ты помнил свой прогресс и полученный опыт!

ПОШАГОВЫЙ АЛГОРИТМ РЕКУРСИВНОГО САМОУЛУЧШЕНИЯ:
а) Проанализируй запрос пользователя. Если для его выполнения тебе не хватает функционала, нового API endpoint или визуальной вкладки / графиков — создай их сам.
б) Напиши соответствующий код бэкенда или фронтенда, обнови файлы проекта.
в) Запусти тест/сборку проекта через run_command с "npm run build" или проверку типов "npm run lint" (tsc --noEmit), чтобы убедиться, что код чистый и скомпилировался без синтаксических ошибок.
г) Если возникла ошибка — прочитай логи компиляции, исправь баг и повтори.
д) Запомни свой новый навык или факт через memorize_lesson.

Инфраструктура окружения:
Ты развернут внутри Docker-контейнера Alpine Linux на VPS. Твой серверный код находится в server.ts (esbuild компилирует его в dist/server.cjs при запуске сборки). Фронтенд — современный React 19 с Vite и Tailwind CSS.
Отвечай всегда на чистом, уверенном русском языке в высокотехнологичном, под ультро-современным углом, уважительном инженерном стиле.`;

      systemText = isReasoning 
        ? `${baseSystemPrompt}\n\nСейчас активирован премиальный предиктивный режим Глубокого Рассуждения (Reasoning/DeepThink). Сфокусируйся на глубоком анализе, выстраивании архитектуры, сложной математической или системной логике и подробно опиши свои рассуждения.`
        : `${baseSystemPrompt}${lessonsBlock}`;

      if (routingSystemInstructionOverride) {
        systemText += routingSystemInstructionOverride;
      }

      loopMessages.unshift({
        role: "system",
        content: systemText
      });
    } else {
      const sysMsg = loopMessages.find(m => m.role === "system");
      if (sysMsg && routingSystemInstructionOverride) {
        sysMsg.content = (sysMsg.content || "") + routingSystemInstructionOverride;
      }
      systemText = sysMsg?.content || "";
    }

    let finalContent = "";
    let reasoningContent = "";
    let totalDuration = 0;
    const toolCallsRecorded: any[] = [];
    let completionNeeded = true;
    let iteration = 0;
    const maxIterations = 5;

    while (completionNeeded && iteration < maxIterations) {
      iteration++;
      console.log(`Superagent Loop Iteration ${iteration}... Provider: ${provider}, Model: ${activeModel}`);

      const startTime = Date.now();
      let hasToolCalls = false;
      let toolCallsToExecute: any[] = [];

      if (provider === "RouterAI") {
        let response;
        try {
          const bodyPayload: any = {
            model: activeModel,
            messages: loopMessages.map((m: any) => {
              let textContent = m.content || "";
              if (m.files && Array.isArray(m.files) && m.files.length > 0) {
                const fileNames = m.files.map((f: any) => `[Вложенный файл: ${f.name} (тип: ${f.type})]`).join("\n");
                textContent = `${textContent}\n\n${fileNames}`;
              }
              return {
                role: m.role,
                content: textContent,
                tool_calls: m.tool_calls,
                name: m.name,
                tool_call_id: m.tool_call_id,
              };
            }),
            temperature: activeModel.includes("reasoning") ? 1.0 : 0.6,
          };

          // Enable tool-calling loop for normal chat models inside RouterAI
          if (!activeModel.includes("reasoning")) {
            bodyPayload.tools = DEEPSEEK_TOOLS;
            bodyPayload.tool_choice = "auto";
          }

          response = await fetch("https://routerai.ru/api/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${routerKey}`
            },
            body: JSON.stringify(bodyPayload)
          });

          if (!response.ok) {
            const rawErr = await response.text();
            console.error(`RouterAI API server error (${response.status}):`, rawErr);
            throw new Error(`Ошибка сервера RouterAI API (${response.status}): ${rawErr}`);
          }
        } catch (fetchErr: any) {
          console.error("RouterAI fetch error wrapper:", fetchErr);
          if (hasGemini) {
            console.warn("RouterAI failed to complete request. Falling back to Gemini...");
            provider = "Gemini";
            activeModel = "gemini-3.5-flash";
            iteration--;
            continue;
          }
          throw fetchErr;
        }

        const data: any = await response.json();
        totalDuration += Math.round((Date.now() - startTime) / 1000);

        const choice = data?.choices?.[0]?.message;
        finalContent = choice?.content || "";
        if (choice?.reasoning_content) {
          reasoningContent = choice.reasoning_content;
        }

        hasToolCalls = choice?.tool_calls && choice.tool_calls.length > 0;
        if (hasToolCalls) {
          toolCallsToExecute = choice.tool_calls;
          loopMessages.push({
            role: "assistant",
            content: choice.content || null,
            tool_calls: choice.tool_calls
          } as any);
        }
      } else if (provider === "DeepSeek") {
        let response;
        try {
          const bodyPayload: any = {
            model: activeModel,
            messages: loopMessages.map((m: any) => {
              let textContent = m.content || "";
              if (m.files && Array.isArray(m.files) && m.files.length > 0) {
                const fileNames = m.files.map((f: any) => `[Вложенный файл: ${f.name} (тип: ${f.type})]`).join("\n");
                textContent = `${textContent}\n\n${fileNames}`;
              }
              return {
                role: m.role,
                content: textContent,
                tool_calls: m.tool_calls,
                name: m.name,
                tool_call_id: m.tool_call_id,
              };
            }),
            temperature: activeModel === "deepseek-reasoning" ? 1.0 : 0.6,
          };

          if (activeModel !== "deepseek-reasoning") {
            bodyPayload.tools = DEEPSEEK_TOOLS;
            bodyPayload.tool_choice = "auto";
          }

          response = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${deepseekKey}`
            },
            body: JSON.stringify(bodyPayload)
          });

          if (!response.ok) {
            const rawErr = await response.text();
            console.error(`DeepSeek API server error (${response.status}):`, rawErr);
            
            // If Gemini API is available, automatically fall back to avoid downtime (only if selection was 'auto')
            if (hasGemini && modelSelection === "auto") {
              console.warn(`DeepSeek API returned error code ${response.status}. Falling back to Gemini...`);
              provider = "Gemini";
              activeModel = "gemini-3.5-flash";
              iteration--;
              continue;
            }
            throw new Error(`Ошибка сервера DeepSeek API (${response.status}): ${rawErr}`);
          }
        } catch (fetchErr: any) {
          console.error("DeepSeek fetch error wrapper:", fetchErr);
          if (hasGemini && modelSelection === "auto") {
            console.warn("DeepSeek offline or failed. Falling back to Gemini...");
            provider = "Gemini";
            activeModel = "gemini-3.5-flash";
            iteration--;
            continue;
          }
          throw fetchErr;
        }

        const data: any = await response.json();
        totalDuration += Math.round((Date.now() - startTime) / 1000);

        const choice = data?.choices?.[0]?.message;
        finalContent = choice?.content || "";
        if (choice?.reasoning_content) {
          reasoningContent = choice.reasoning_content;
        }

        hasToolCalls = choice?.tool_calls && choice.tool_calls.length > 0;
        if (hasToolCalls) {
          toolCallsToExecute = choice.tool_calls;
          loopMessages.push({
            role: "assistant",
            content: choice.content || null,
            tool_calls: choice.tool_calls
          } as any);
        }
      } else {
        // Gemini Provider
        const client = getGeminiClient(geminiKey);
        
        // Setup gemini compatible tools
        const geminiTools = [
          {
            functionDeclarations: DEEPSEEK_TOOLS.map(t => ({
              name: t.function.name,
              description: t.function.description,
              parameters: {
                type: "OBJECT",
                properties: t.function.parameters.properties,
                required: t.function.parameters.required
              }
            }))
          }
        ];

        // Format message tree to Gemini parts format
        const geminiContents: any[] = [];
        for (const msg of loopMessages) {
          if (msg.role === "system") continue;
          
          if (msg.parts && Array.isArray(msg.parts)) {
            geminiContents.push({
              role: msg.role === "assistant" ? "model" : "user",
              parts: msg.parts
            });
            continue;
          }
          
          const parts: any[] = [];
          if (msg.content) {
            parts.push({ text: msg.content });
          }
          
          if (msg.files && Array.isArray(msg.files)) {
            for (const file of msg.files) {
              const match = file.base64.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                const mimeType = match[1];
                const base64Data = match[2];
                parts.push({
                  inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                  }
                });
              }
            }
          }
          
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              parts.push({
                functionCall: {
                  name: tc.function.name,
                  args: typeof tc.function.arguments === "string" 
                    ? JSON.parse(tc.function.arguments) 
                    : tc.function.arguments
                }
              });
            }
          }
          
          if (msg.role === "tool") {
            parts.push({
              functionResponse: {
                name: msg.name,
                response: { result: msg.content }
              }
            });
          }

          geminiContents.push({
            role: msg.role === "assistant" ? "model" : "user",
            parts
          });
        }

        const configPayload: any = {
          systemInstruction: systemText,
          temperature: 0.6,
        };

        // Standard gemini supports function calling, use it
        configPayload.tools = geminiTools;

        let response;
        try {
          response = await client.models.generateContent({
            model: activeModel,
            contents: geminiContents,
            config: configPayload
          });
        } catch (geminiErr: any) {
          console.error("Gemini API generation failed:", geminiErr);
          if (hasRouter) {
            console.warn("Gemini is currently overloaded or failing. Automatically falling back to RouterAI...");
            provider = "RouterAI";
            activeModel = "google/gemini-2.0-flash";
            iteration--;
            continue;
          }
          throw new Error(`Сервис Gemini временно перегружен или недоступен (503). Ссылка на причину: ${geminiErr.message || geminiErr}`);
        }

        totalDuration += Math.round((Date.now() - startTime) / 1000);
        finalContent = response.text || "";

        const gCalls = response.functionCalls;
        hasToolCalls = gCalls && gCalls.length > 0;

        if (hasToolCalls) {
          // Map to standard tool call format
          const mappedCalls = gCalls.map((fc: any, idx: number) => ({
            id: `call-${Date.now()}-${idx}`,
            type: "function",
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.args)
            }
          }));

          toolCallsToExecute = mappedCalls;
          loopMessages.push({
            role: "assistant",
            content: finalContent || null,
            parts: response.candidates?.[0]?.content?.parts || [],
            tool_calls: mappedCalls
          } as any);
        }
      }

      if (!hasToolCalls) {
        completionNeeded = false;
        break;
      }

      // We have tool calls to execute!
      console.log(`Executing ${toolCallsToExecute.length} tool calls...`);

      for (const tc of toolCallsToExecute) {
        const toolName = tc.function.name;
        let args: any = {};
        try {
          args = typeof tc.function.arguments === "string" 
            ? JSON.parse(tc.function.arguments) 
            : tc.function.arguments;
        } catch (e) {
          console.error("Arg parsing error:", tc.function.arguments);
        }

        let output = "";
        let status: "success" | "error" = "success";

        try {
          if (toolName === "read_file") {
            output = await read_file_tool(args.path);
          } else if (toolName === "write_file") {
            output = await write_file_tool(args.path, args.content);
          } else if (toolName === "run_command") {
            output = await run_command_tool(args.command);
          } else if (toolName === "web_search") {
            output = await web_search_tool(args.query);
          } else if (toolName === "scrape_url") {
            output = await scrape_url_tool(args.url);
          } else if (toolName === "document_rag_search") {
            output = await document_rag_search_tool(args.path, args.query);
          } else if (toolName === "memorize_lesson") {
            const newItem = await add_lesson_record(args.category, args.title, args.details);
            output = `Новый урок "${newItem.title}" успешно сохранен в базу знаний самообучения VPS. Номер записи: ${newItem.id}`;
          } else {
            output = `Инструмент ${toolName} не поддерживается.`;
            status = "error";
          }
        } catch (execErr: any) {
          output = `Ошибка исполнения инструмента: ${execErr.message}`;
          status = "error";
        }

        toolCallsRecorded.push({
          toolName,
          arguments: args,
          output,
          status
        });

        // Add tool response to loopMessages
        loopMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: toolName,
          content: output
        } as any);
      }
    }

    return res.json({
      role: "assistant",
      content: finalContent,
      reasoningContent: reasoningContent || undefined,
      thinkingTime: reasoningContent || toolCallsRecorded.length > 0 ? totalDuration : undefined,
      provider: `${provider} API`,
      modelUsed: activeModel,
      toolCalls: toolCallsRecorded.length > 0 ? toolCallsRecorded : undefined
    });

  } catch (error: any) {
    console.error("Superagent Controller Error:", error);
    res.status(500).json({
      error: error.message || "Ошибка при выполнении запроса суперагента.",
    });
  }
});

/**
 * Voice Transcription Endpoint utilizing server-side Gemini 3.5 Flash
 */
app.post("/api/transcribe", async (req, res): Promise<any> => {
  try {
    const { audio, mimeType, geminiApiKey } = req.body;
    if (!audio) {
      return res.status(400).json({ error: "Предоставьте звуковые данные (base64) для транскрибирования." });
    }

    const key = geminiApiKey || req.headers["x-gemini-key"] || process.env.GEMINI_API_KEY;
    if (!key || key.trim() === "" || key.includes("MY_GEMINI_API_KEY")) {
      return res.status(400).json({
        error: "Для распознавания голосовых сообщений требуется настроенный GEMINI_API_KEY в Secrets/Свойствах проекта."
      });
    }

    console.log(`[Voice] Starting transcription... mimeType: ${mimeType || "audio/webm"}`);
    
    // Remove potential dataURL prefix
    let cleanBase64 = audio;
    if (audio.includes(";base64,")) {
      cleanBase64 = audio.split(";base64,")[1];
    }

    const ai = getGeminiClient(key);
    
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        {
          inlineData: {
            data: cleanBase64,
            mimeType: mimeType || "audio/webm"
          }
        },
        {
          text: "Транскрибируй это аудиосообщение на русском языке. Напиши только услышанный текст, без каких-либо комментариев, знаков препинания или собственных исправлений."
        }
      ]
    });

    const transcribedText = response.text || "";
    console.log(`[Voice] Transcribed Text: "${transcribedText.trim()}"`);
    return res.json({ text: transcribedText.trim() });
  } catch (err: any) {
    console.error("Transcription Controller Error:", err);
    return res.status(500).json({
      error: err.message || "Не удалось расшифровать голосовую запись."
    });
  }
});

/**
 * REST API for Session persistence across VPS server
 */
app.get("/api/sessions", async (req, res) => {
  try {
    const files = await fs.readdir(CONVERSATIONS_DIR);
    const sessions = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const raw = await fs.readFile(path.join(CONVERSATIONS_DIR, file), "utf-8");
          sessions.push(JSON.parse(raw));
        } catch (e) {
          console.error(`Corrupt session file skipped: ${file}`);
        }
      }
    }
    // Sort chronologically (newest first)
    sessions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(sessions);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read sessions: " + err.message });
  }
});

app.post("/api/sessions", async (req, res) => {
  try {
    const session = req.body;
    if (!session || !session.id) {
      return res.status(400).json({ error: "Missing session body payload or session ID." });
    }
    const targetFile = path.join(CONVERSATIONS_DIR, `${session.id}.json`);
    await fs.writeFile(targetFile, JSON.stringify(session, null, 2), "utf-8");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to save session: " + err.message });
  }
});

app.delete("/api/sessions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const targetFile = path.join(CONVERSATIONS_DIR, `${id}.json`);
    await fs.unlink(targetFile);
    res.json({ success: true });
  } catch (err: any) {
    // If file already deleted, ignore and succeed
    res.json({ success: true });
  }
});

/**
 * REST API for Lessons persistence (Agent self-learning experience DB)
 */
app.get("/api/lessons", async (req, res) => {
  try {
    const lessons = await get_lessons();
    res.json(lessons);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to read lessons: " + err.message });
  }
});

app.delete("/api/lessons/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const list = await get_lessons();
    const filtered = list.filter(l => l.id !== id);
    await fs.writeFile(LESSONS_FILE, JSON.stringify(filtered, null, 2), "utf-8");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete lesson: " + err.message });
  }
});

// Setup Vite middleware in Development mode, otherwise serve build files in Production mode
const startServer = async () => {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
};

startServer().catch((err) => {
  console.error("Error starting server:", err);
});
