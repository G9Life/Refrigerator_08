const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const imageInput = document.querySelector("#imageInput");
const previewWrap = document.querySelector("#previewWrap");
const previewImage = document.querySelector("#previewImage");
const fileName = document.querySelector("#fileName");
const recognizeButton = document.querySelector("#recognizeButton");
const clearButton = document.querySelector("#clearButton");
const statusMessage = document.querySelector("#statusMessage");
const resultPanel = document.querySelector("#resultPanel");
const ingredientsList = document.querySelector("#ingredientsList");
const addIngredientButton = document.querySelector("#addIngredientButton");
const confirmButton = document.querySelector("#confirmButton");
const confirmedPanel = document.querySelector("#confirmedPanel");
const confirmedSummary = document.querySelector("#confirmedSummary");
const confirmedJson = document.querySelector("#confirmedJson");

let imageDataUrl = "";
let ingredients = [];
let recognitionController = null;
let recognitionRequestId = 0;

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
  cancelRecognition();
  resetResults();

  if (!file) {
    clearImage();
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    setStatus("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.", true);
    clearImage();
    return;
  }

  if (file.size > MAX_IMAGE_BYTES) {
    setStatus("이미지 크기는 10MB 이하여야 합니다.", true);
    clearImage();
    return;
  }

  imageDataUrl = await readFileAsDataUrl(file);
  previewImage.src = imageDataUrl;
  fileName.textContent = `선택됨: ${file.name}`;
  fileName.classList.remove("hidden");
  previewWrap.classList.remove("hidden");
  recognizeButton.disabled = false;
  setStatus("사진이 준비되었습니다. 아래 버튼을 눌러 재료를 찾아보세요.");
});

recognizeButton.addEventListener("click", async () => {
  if (!imageDataUrl) {
    setStatus("먼저 이미지를 선택하세요.", true);
    return;
  }

  cancelRecognition();
  recognitionController = new AbortController();
  const requestId = ++recognitionRequestId;

  recognizeButton.disabled = true;
  clearButton.disabled = false;
  setLoadingState(true);
  setStatus("재료를 찾는 중입니다. 화면을 닫지 말고 잠시 기다려 주세요.");

  try {
    const response = await fetch("/api/recognize-ingredients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageDataUrl }),
      signal: recognitionController.signal
    });

    const result = await response.json();
    if (requestId !== recognitionRequestId) {
      return;
    }

    if (!response.ok) {
      throw new Error(result.error || "재료 인식에 실패했습니다.");
    }

    ingredients = normalizeIngredients(result.ingredients);
    renderIngredients();
    resultPanel.classList.remove("hidden");
    setStatus(`재료 후보 ${ingredients.length}개를 찾았습니다. 결과를 확인하고 수정하세요.`);
  } catch (error) {
    if (error.name !== "AbortError") {
      setLoadingState(false);
      setStatus(`${error.message} 사진이 선명한지 확인하고 다시 시도해 주세요.`, true);
      recognizeButton.textContent = "다시 인식하기";
    }
  } finally {
    if (requestId === recognitionRequestId) {
      recognitionController = null;
      recognizeButton.disabled = !imageDataUrl;
      if (!statusMessage.classList.contains("error")) {
        setLoadingState(false);
      }
    }
  }
});

clearButton.addEventListener("click", () => {
  cancelRecognition();
  imageInput.value = "";
  clearImage();
  resetResults();
  setStatus("");
});

addIngredientButton.addEventListener("click", () => {
  ingredients.push({
    name: "",
    quantity_estimate: "알 수 없음",
    confidence: 0,
    notes: "사용자 추가"
  });
  renderIngredients();
});

confirmButton.addEventListener("click", () => {
  const beforeCount = ingredients.length;
  const confirmed = ingredients
    .map((ingredient) => ({
      name: ingredient.name.trim(),
      quantity_estimate: ingredient.quantity_estimate.trim() || "알 수 없음",
      confidence: clamp(Number(ingredient.confidence), 0, 1),
      notes: ingredient.notes.trim()
    }))
    .filter((ingredient) => ingredient.name);

  localStorage.setItem("step1_confirmed_ingredients", JSON.stringify(confirmed));
  const removedCount = beforeCount - confirmed.length;
  confirmedSummary.textContent = `재료 ${confirmed.length}개를 Step 2 입력값으로 저장했습니다.${
    removedCount > 0 ? ` 빈 재료명 ${removedCount}개는 제외했습니다.` : ""
  }`;
  confirmedJson.textContent = JSON.stringify({ ingredients: confirmed }, null, 2);
  confirmedPanel.classList.remove("hidden");
  setStatus("재료 목록을 확정했습니다. 다음 단계에서 사용할 수 있습니다.");
});

function renderIngredients() {
  ingredientsList.innerHTML = "";

  if (ingredients.length === 0) {
    const empty = document.createElement("p");
    empty.className = "status";
    empty.textContent = "인식된 재료가 없습니다. 재료를 직접 추가할 수 있습니다.";
    ingredientsList.append(empty);
    return;
  }

  ingredients.forEach((ingredient, index) => {
    const row = document.createElement("div");
    row.className = "ingredient-row";

    row.append(
      createInputField(`재료명 ${index + 1}`, ingredient.name, (value) => {
        ingredients[index].name = value;
      }),
      createInputField(`추정 수량 ${index + 1}`, ingredient.quantity_estimate, (value) => {
        ingredients[index].quantity_estimate = value;
      }),
      createInputField(`신뢰도 ${index + 1}`, String(ingredient.confidence), (value) => {
        ingredients[index].confidence = value;
      }, "number", "0", "1", "0.01"),
      createInputField(`메모 ${index + 1}`, ingredient.notes, (value) => {
        ingredients[index].notes = value;
      })
    );

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "삭제";
    deleteButton.setAttribute("aria-label", `${ingredient.name || index + 1 + "번째 재료"} 삭제`);
    deleteButton.addEventListener("click", () => {
      ingredients.splice(index, 1);
      renderIngredients();
    });
    row.append(deleteButton);

    ingredientsList.append(row);
  });
}

function createInputField(labelText, value, onInput, type = "text", min, max, step) {
  const wrapper = document.createElement("div");
  wrapper.className = "field";
  const inputId = `ingredient-${labelText.replace(/\s+/g, "-")}-${Math.random().toString(36).slice(2)}`;

  const label = document.createElement("label");
  label.textContent = labelText;
  label.htmlFor = inputId;

  const input = document.createElement("input");
  input.id = inputId;
  input.type = type;
  input.value = value;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  if (step !== undefined) input.step = step;
  input.addEventListener("input", () => onInput(input.value));

  wrapper.append(label, input);
  return wrapper;
}

function normalizeIngredients(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.map((item) => ({
    name: String(item.name || ""),
    quantity_estimate: String(item.quantity_estimate || "알 수 없음"),
    confidence: clamp(Number(item.confidence), 0, 1),
    notes: String(item.notes || "")
  }));
}

function clearImage() {
  imageDataUrl = "";
  fileName.textContent = "";
  fileName.classList.add("hidden");
  previewImage.removeAttribute("src");
  previewWrap.classList.add("hidden");
  recognizeButton.disabled = true;
}

function resetResults() {
  ingredients = [];
  ingredientsList.innerHTML = "";
  resultPanel.classList.add("hidden");
  confirmedPanel.classList.add("hidden");
  confirmedSummary.textContent = "";
  confirmedJson.textContent = "";
}

function cancelRecognition() {
  recognitionRequestId += 1;
  if (recognitionController) {
    recognitionController.abort();
    recognitionController = null;
  }

  setLoadingState(false);
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
  statusMessage.setAttribute("aria-live", isError ? "assertive" : "polite");
}

function setLoadingState(isLoading) {
  recognizeButton.classList.toggle("loading", isLoading);
  recognizeButton.setAttribute("aria-busy", String(isLoading));
  recognizeButton.textContent = isLoading ? "재료를 찾는 중..." : "사진에서 재료 찾기";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}
