// eslint-disable-next-line @typescript-eslint/no-var-requires
import type { Core } from "@strapi/strapi"

const TG_API = `https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}`;
const DEFAULT_CHAT_ID = process.env.DEFAULT_CHAT_ID;
const MAX_LEN = 4096;

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

function splitText(text: string, size = MAX_LEN) {
  if (!text) return [''];
  const parts = [];
  for (let i = 0; i < text.length; i += size) {
    parts.push(text.slice(i, i + size));
  }
  return parts;
}

async function tgCall<T = any>(method: string, params: Record<string, any>): Promise<T> {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) body.append(k, String(v));
  });

  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as TelegramResponse<T>;
  if (!res.ok || !json.ok) {
    const msg = json.description || res.statusText;
    throw new Error(`Telegram ${method} failed: ${msg}`);
  }
  return json.result as T;
}

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  // 🔽 методы бота
  async sendTelegramMessage({ chatId, text, parseMode, threadId, replyMarkup }: any) {
    const chat_id = chatId || DEFAULT_CHAT_ID;
    if (!chat_id) throw new Error('chatId required');
    if (!text) throw new Error('text required');

    const chunks = splitText(text);
    const results: any[] = [];
    for (const chunk of chunks) {
      const r = await tgCall('sendMessage', {
        chat_id,
        text: chunk,
        parse_mode: parseMode,
        disable_web_page_preview: true,
        message_thread_id: threadId,
        reply_markup: replyMarkup ? JSON.stringify(replyMarkup) : undefined, // ← добавляем сюда
      });
      results.push(r);
    }
    return { ok: true, sent: results.length };
  },

  async sendTelegramDocument({ chatId, fileUrl, caption, threadId }: any) {
    const chat_id = chatId || DEFAULT_CHAT_ID;
    if (!chat_id) throw new Error('chatId required');
    if (!fileUrl) throw new Error('fileUrl required');

    const r = await tgCall('sendDocument', {
      chat_id,
      document: fileUrl,
      caption,
      message_thread_id: threadId,
    });
    return { ok: true, result: r };
  },

  // 🔽 обработка апдейтов от Telegram (для /getchatid)
  async handleTelegramUpdate(update: any) {
    try {
      strapi.log.debug('[tg] incoming update', JSON.stringify(update));

      // 🔹 обработка нажатий кнопок
      if (update.callback_query) {
        const chatId = update.callback_query.message.chat.id;
        const data = update.callback_query.data;
        const cbId = update.callback_query.id;

        strapi.log.info(`[tg] callback_query data=${data} chatId=${chatId}`);

        if (data === 'accept_agreement') {
          // отвечаем Telegram, чтобы убрать "часики"
          const res = await tgCall('answerCallbackQuery', {
            callback_query_id: cbId,
            text: 'Соглашение принято ✅'
          });
          strapi.log.debug('[tg] answerCallbackQuery result', res);

          // сразу шлём сообщение с кнопкой WebApp
          await this.sendTelegramMessage({
            chatId,
            text: 'Теперь вы можете безопасно запустить AML-проверку вашего кошелька прямо в нашем WebApp:',
            replyMarkup: {
              inline_keyboard: [
                [
                  {
                    text: '🚀 Запустить AML проверку',
                    web_app: { url: 'https://amibot.cc/check' }
                  }
                ]
              ]
            }
          });

          // можно дополнительно (после AML кнопки) прислать меню, если хочешь
          // await this.sendTelegramMessage({
          //   chatId,
          //   text: 'Для других действий воспользуйтесь меню ниже:',
          //   replyMarkup: {
          //     inline_keyboard: [
          //       [
          //         { text: '🔍 Проверка', callback_data: 'check' },
          //         { text: '💳 Пополнить', callback_data: 'deposit' }
          //       ],
          //       [
          //         { text: '🧪 Расследование', callback_data: 'investigate' },
          //         { text: '📡 Трекинг', callback_data: 'tracking' }
          //       ],
          //       [
          //         { text: '✋ Украли крипту!', callback_data: 'stolen' },
          //         { text: '👤 Мой аккаунт', callback_data: 'account' }
          //       ]
          //     ]
          //   }
          // });
        }

        // можно добавить другие callback_data здесь
        return { ok: true };
      }

      // 🔹 обработка текстовых сообщений
      if (update.message && update.message.text) {
        const chatId = update.message.chat.id;
        const text = update.message.text.trim();

        strapi.log.info(`[tg] message text="${text}" chatId=${chatId}`);

        if (text === '/getchatid') {
          await this.sendTelegramMessage({
            chatId,
            text: `Ваш chat_id: ${chatId}`,
          });
        }

        if (text === '/start') {
          await this.sendTelegramMessage({
            chatId,
            text: 'Для использования бота необходимо принять Пользовательское соглашение:',
            parseMode: 'HTML',
            replyMarkup: {
              inline_keyboard: [
                [
                  {
                    text: '✅ Принимаю соглашение',
                    callback_data: 'accept_agreement'
                  }
                ]
              ]
            }
          });
        }
      }

      return { ok: true };
    } catch (error) {
      strapi.log.error('[bff] handleTelegramUpdate error:', error);
      return { ok: false, error: error.message };
    }
  },
})
