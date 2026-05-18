const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const imageInput = document.querySelector("#imageInput");
const previewWrap = document.querySelector("#previewWrap");
const previewImage = document.querySelector("#previewImage");
const recognizeButton = document.querySelector("#recognizeButton");
const clearButton = document.querySelector("#clearButton");
const statusMessage = document.querySelector("#statusMessage");
const resultPanel = document.querySelector("#resultPanel");
const ingredientsList = document.querySelector("#ingredientsList");
const addIngredientButton = document.querySelector("#addIngredientButton");
const confirmButton = document.querySelector("#confirmButton");
const confirmedPanel = document.querySelector("#confirmedPanel");
const confirmedJson = document.querySelector("#confirmedJson");

let imageDataUrl = "";
let ingredients = [];

imageInput.addEventListener("change", async () => {
  const file = imageInput.files?.[0];
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
  previewWrap.classList.remove("hidden");
  recognizeButton.disabled = false;
  setStatus("이미지가 준비되었습니다. 재료 인식을 실행하세요.");
});

recognizeButton.addEventListener("click", async () => {
  if (!imageDataUrl) {
    setStatus("먼저 이미지를 선택하세요.", true);
    return;
  }

  recognizeButton.disabled = true;
  setStatus("OpenRouter 모델로 재료를 인식하는 중입니다...");

  try {
    const response = await fetch("/api/recognize-ingredients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageDataUrl })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "재료 인식에 실패했습니다.");
    }

    ingredients = normalizeIngredients(result.ingredients);
    renderIngredients();
    resultPanel.classList.remove("hidden");
    setStatus(`재료 후보 ${ingredients.length}개를 찾았습니다. 결과를 확인하고 수정하세요.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    recognizeButton.disabled = false;
  }
});

clearButton.addEventListener("click", () => {
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
  const confirmed = ingredients
    .map((ingredient) => ({
      name: ingredient.name.trim(),
      quantity_estimate: ingredient.quantity_estimate.trim() || "알 수 없음",
      confidence: clamp(Number(ingredient.confidence), 0, 1),
      notes: ingredient.notes.trim()
    }))
    .filter((ingredient) => ingredient.name);

  localStorage.setItem("step1_confirmed_ingredients", JSON.stringify(confirmed));
  confirmedJson.textContent = JSON.stringify({ ingredients: confirmed }, null, 2);
  confirmedPanel.classList.remove("hidden");
  setStatus("재료 목록을 확정했습니다. 브라우저 localStorage에도 저장했습니다.");
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
      createInputField("재료명", ingredient.name, (value) => {
        ingredients[index].name = value;
      }),
      createInputField("추정 수량", ingredient.quantity_estimate, (value) => {
        ingredients[index].quantity_estimate = value;
      }),
      createInputField("신뢰도", String(ingredient.confidence), (value) => {
        ingredients[index].confidence = value;
      }, "number", "0", "1", "0.01"),
      createInputField("메모", ingredient.notes, (value) => {
        ingredients[index].notes = value;
      })
    );

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "삭제";
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

  const label = document.createElement("label");
  label.textContent = labelText;

  const input = document.createElement("input");
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
  previewImage.removeAttribute("src");
  previewWrap.classList.add("hidden");
  recognizeButton.disabled = true;
}

function resetResults() {
  ingredients = [];
  ingredientsList.innerHTML = "";
  resultPanel.classList.add("hidden");
  confirmedPanel.classList.add("hidden");
  confirmedJson.textContent = "";
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
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
