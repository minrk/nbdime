// Type definitions for CodeMirror
// Project: https://github.com/marijnh/CodeMirror
// Definitions by: jacqt <https://github.com/vidartf>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped


// Typings from the codemirror/mode/meta module

declare namespace CodeMirror {

    function findModeByName(name: string): modespec;
    function findModeByExtension(name: string): modespec;
    function findModeByFileName(name: string): modespec;
    function findModeByMIME(mime: string): modespec;

    interface ModeInfo {
      ext: string[];
      mime: string;
      mode: string;
      name: string;
    }
    var modeInfo: ModeInfo[];
}
