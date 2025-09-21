import axios from 'axios'

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:8000'

// 🔹 очистка ответа LLaMA
export function cleanAssistantAnswer(text: string): string {
  if (!text) return ""
  // убираем служебные подписи
  text = text.replace(/Пользователь:.*?\n/g, "")
  text = text.replace(/Ассистент:/g, "")
  // берём только первую «фразу» до \n\n
  const firstBlock = text.split(/\n\n/)[0]
  return firstBlock.trim()
}


// 🔹 сборка промпта
export function buildPrompt(instructions: string[], history: string, userText: string): string {
  return [
    '=== Instructions ===',
    instructions.join('\n'),
    '=== Dialogue history ===',
    history,
    `Пользователь: ${userText}`,
    'Ассистент:',
  ].filter(Boolean).join('\n')
}

// 🔹 проверка на бред
export async function validateAnswer(userText: string, cleanAnswer: string): Promise<string> {
  const validationPrompt = [
    'Check the assistant’s answer for correctness.',
    'Rules:',
    '- The answer must be grammatically correct and logical.',
    '- The answer must not contain irrelevant information.',
    '- If the answer is fine, return it unchanged.',
    '- If irrelevant, return corrected version.',
    '- If the answer contains [ANSWER] and/or [COMMAND], keep them. ' +
    'You may rewrite inside [ANSWER], but block structure must remain.',
    '',
    `User question: ${userText}`,
    `Assistant answer: ${cleanAnswer}`,
    '',
    'Validated answer:',
  ].join('\n')

  const resp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: validationPrompt }, { validateStatus: () => true })
  return resp.status === 200 && resp.data?.answer
    ? cleanAssistantAnswer(resp.data.answer)
    : cleanAnswer
}

export async function validateCommand(userText: string, validated: string): Promise<string> {
  // --- Шаг 1. Проверяем, просит ли пользователь действие ---
  const detectActionPrompt = [
    'You are an action detector.',
    'Decide if the user explicitly asked to perform an action.',
    'Examples of actions: send, create, turn on, remind, call, open, play.',
    'Answer only YES or NO.',
    '',
    `User question: ${userText}`,
    '',
    'Answer:'
  ].join('\n')

  const detectResp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: detectActionPrompt }, { validateStatus: () => true })
  const isAction = detectResp.status === 200 && /yes/i.test(detectResp.data?.answer || '')

  if (!isAction) {
    // Пользователь не просил действия → чистим [COMMAND]
    const stripPrompt = [
      'Remove all [COMMAND] blocks from the assistant answer.',
      'Do not touch [ANSWER].',
      '',
      `Assistant answer: ${validated}`,
      '',
      'Clean answer:'
    ].join('\n')

    const stripResp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: stripPrompt }, { validateStatus: () => true })
    return stripResp.status === 200 && stripResp.data?.answer
      ? cleanAssistantAnswer(stripResp.data.answer)
      : validated
  }

  // --- Шаг 2a. Уточняем команду с контекстом ответа ---
  const withContextPrompt = [
    'Extract the intended [COMMAND] block based on the user request and assistant answer.',
    '',
    `User question: ${userText}`,
    `Assistant answer: ${validated}`,
    '',
    'Output only one corrected [COMMAND] block.'
  ].join('\n')

  const withContextResp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: withContextPrompt }, { validateStatus: () => true })
  const commandWithContext = cleanAssistantAnswer(withContextResp.data?.answer || '')

  // --- Шаг 2b. Уточняем команду только по тексту пользователя ---
  const fromUserPrompt = [
    'Extract the intended [COMMAND] block only from the user question, ignoring the assistant answer.',
    '',
    `User question: ${userText}`,
    '',
    'Output only one [COMMAND] block.'
  ].join('\n')

  const fromUserResp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: fromUserPrompt }, { validateStatus: () => true })
  const commandFromUser = cleanAssistantAnswer(fromUserResp.data?.answer || '')

  // --- Шаг 3. Объединяем результаты ---
  const mergePrompt = [
    'You are a command merger.',
    'Task: combine the two extracted [COMMAND] blocks into the final correct one.',
    'Rules:',
    '- If they differ, choose the one that matches user intent best.',
    '- Keep only ONE [COMMAND] block.',
    '',
    `Option A (with context): ${commandWithContext}`,
    `Option B (from user): ${commandFromUser}`,
    '',
    'Final [COMMAND]:'
  ].join('\n')

  const mergeResp = await axios.post(`${PYTHON_API_URL}/ask_text`, { text: mergePrompt }, { validateStatus: () => true })
  const finalCommand = cleanAssistantAnswer(mergeResp.data?.answer || '')

  // --- Склеиваем финальный ответ ---
  return `${validated}\n${finalCommand}`
}

