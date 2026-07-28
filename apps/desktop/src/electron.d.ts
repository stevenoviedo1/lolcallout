interface LolCalloutBridge {
  isElectron?: boolean;
  getVersion?: () => Promise<string>;
  openExternal?: (url: string) => Promise<boolean>;
  setAlwaysOnTop?: (on: boolean) => Promise<boolean>;
}

interface Window {
  lolcallout?: LolCalloutBridge;
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}
