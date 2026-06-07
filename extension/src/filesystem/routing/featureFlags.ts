import { OperationMode } from './operationMode';

export interface FilesystemFeatureFlags {
    stat: OperationMode;

    readDirectory: OperationMode;

    readFile: OperationMode;

    writeFile: OperationMode;

    createDirectory: OperationMode;

    delete: OperationMode;

    rename: OperationMode;
}

export const DEFAULT_FILESYSTEM_FEATURE_FLAGS: FilesystemFeatureFlags = {
    stat: 'local',

    readDirectory: 'local',

    readFile: 'local',

    writeFile: 'local',

    createDirectory: 'local',

    delete: 'local',

    rename: 'local'
};
