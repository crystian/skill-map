import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
export const BINARY_NAME = 'sm';
export const BINARY_LABEL = 'skill-map';
