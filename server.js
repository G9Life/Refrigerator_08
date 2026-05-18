const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const MODEL = "google/gemma-3-27b-it:free";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PUBLIC_DIR = path.join(__dirname, "public");

loadEnvFile(path.join(__dirname, ".env"));

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/recognize-ingredients") {
      await handleRecognizeIngredients(req, res);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "지원하지 않는 요청입니다." });
  } catch (error) {
    console.error("Unexpected server error:", error.message);
    sendJson(res, 500, { error: "서버 오류가 발생했습니다." });
  }
});

server.listen(PORT, () => {
  console.log(`Refrigerator Step 1 app is running at http://localhost:${PORT}`);
});

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function handleRecognizeIngredients(req, res) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "OPENROUTER_API_KEY가 설정되어 있지 않습니다." });
    return;
  }

  const body = await readJsonBody(req);
  const image = typeof body.image === "string" ? body.image : "";
  const validationError = validateImageDataUrl(image);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Refrigerator Ingredient Recognizer"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 1000,
      messages: [
        {
          role: "system",
          content:
            "You identify visible food ingredients in refrigerator photos. Return only valid JSON. Do not include markdown."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "이 냉장고 사진에서 실제로 보이는 식재료만 한국어로 추출해 주세요. 보이지 않는 재료는 추측하지 마세요. 응답은 반드시 {\"ingredients\":[{\"name\":\"재료명\",\"quantity_estimate\":\"추정 수량 또는 알 수 없음\",\"confidence\":0.0,\"notes\":\"근거 또는 불확실한 이유\"}]} 형식의 JSON만 반환하세요."
            },
            {
              type: "image_url",
              image_url: { url: image }
            }
          ]
        }
      ]
    })
  });

  const responseText = await openRouterResponse.text();
  if (!openRouterResponse.ok) {
    const message = extractOpenRouterError(responseText) || "OpenRouter 호출에 실패했습니다.";
    const status = openRouterResponse.status === 429 ? 429 : 502;
    sendJson(res, status, { error: message });
    return;
  }

  let completion;
  try {
    completion = JSON.parse(responseText);
  } catch {
    sendJson(res, 502, { error: "OpenRouter 응답을 해석할 수 없습니다." });
    return;
  }

  const modelContent = completion?.choices?.[0]?.message?.content || "";
  const parsedIngredients = parseIngredients(modelContent);
  if (!parsedIngredients) {
    sendJson(res, 502, {
      error: "모델 응답에서 재료 JSON을 찾지 못했습니다.",
      raw_model_response: modelContent
    });
    return;
  }

  sendJson(res, 200, {
    ingredients: parsedIngredients,
    raw_model_response: process.env.NODE_ENV === "development" ? modelContent : undefined
  });
}

function validateImageDataUrl(image) {
  const match = image.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return "JPG, PNG, WebP 형식의 이미지 data URL만 지원합니다.";
  }

  const estimatedBytes = Math.floor((match[2].length * 3) / 4);
  if (estimatedBytes > MAX_IMAGE_BYTES) {
    return "이미지 크기는 10MB 이하여야 합니다.";
  }

  return "";
}

function parseIngredients(content) {
  const jsonText = extractJsonText(content);
  if (!jsonText) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText);
    const list = Array.isArray(parsed) ? parsed : parsed.ingredients;
    if (!Array.isArray(list)) {
      return null;
    }

    return list
      .map((item) => ({
        name: String(item?.name || "").trim(),
        quantity_estimate: String(item?.quantity_estimate || "알 수 없음").trim(),
        confidence: normalizeConfidence(item?.confidence),
        notes: String(item?.notes || "").trim()
      }))
      .filter((item) => item.name);
  } catch {
    return null;
  }
}

function extractJsonText(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    return "";
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }

  return trimmed;
}

function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(1, number));
}

function extractOpenRouterError(responseText) {
  try {
    const parsed = JSON.parse(responseText);
    return parsed?.error?.metadata?.raw || parsed?.error?.message || "";
  } catch {
    return responseText;
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_IMAGE_BYTES * 2) {
        req.destroy();
        reject(new Error("요청 본문이 너무 큽니다."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON 요청 본문을 해석할 수 없습니다."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden", "text/plain");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(res, 404, "Not found", "text/plain");
      return;
    }

    sendText(res, 200, content, getContentType(filePath));
  });
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function sendJson(res, status, payload) {
  const cleanedPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
  sendText(res, status, JSON.stringify(cleanedPayload), "application/json; charset=utf-8");
}

function sendText(res, status, content, contentType) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(content);
}
