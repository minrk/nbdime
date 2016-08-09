// Type definitions for CodeMirror
// Project: https://github.com/marijnh/CodeMirror
// Definitions by: jacqt <https://github.com/vidartf>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped


// Typings from the codemirror/mode/meta module

declare namespace CodeMirror {
    function runMode(code: string, mode: modespec | string, el: HTMLElement | ((text: string, style: string) => void)): void;
}
