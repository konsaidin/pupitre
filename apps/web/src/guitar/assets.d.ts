// Ассеты гитарного раздела, встраиваемые в чанк (под file:// fetch локальных файлов не работает, инв. 20).
declare module '*.sf3?inline' {
  const dataUri: string;
  export default dataUri;
}
