// Подпись macOS (electron-builder: mac.sign). Есть сертификат Developer ID (в связке ключей или CSC_LINK) — обычная
// подпись. Нет — ad-hoc («-»): без подписи сборка не запустится на Apple Silicon (после упаковки родная подпись Electron
// недействительна); метку времени ad-hoc не ставит. Скачанную ad-hoc сборку пользователь снимает с карантина сам
// (README → Download).
const { sign } = require('@electron/osx-sign');

module.exports = async function signMac(opts) {
  if (opts.identity) return sign(opts);
  console.log('[sign-mac] сертификата Developer ID нет — ad-hoc подпись');
  return sign({
    ...opts,
    identity: '-',
    identityValidation: false,
    optionsForFile: (file) => ({ ...opts.optionsForFile?.(file), timestamp: 'none' }),
  });
};
