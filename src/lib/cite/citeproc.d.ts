// citeproc-js tidak punya tipe; hanya yang dipakai yang dideklarasikan.
declare module "citeproc" {
  interface Engine {
    setOutputFormat(format: string): void;
    updateItems(ids: string[]): void;
    makeBibliography(): [unknown, string[]] | false;
    processCitationCluster(cluster: unknown, pre: unknown[], post: unknown[]): [unknown, [number, string, string][]];
  }
  const CSL: {
    Engine: new (sys: { retrieveLocale: (lang: string) => string; retrieveItem: (id: string) => unknown }, style: string, lang?: string, forceLang?: boolean) => Engine;
  };
  export default CSL;
}
