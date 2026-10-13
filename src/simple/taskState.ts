import { useEffect, useState } from 'react';
import { readSaved, saveLocal } from './library';
const prefix = window.memories ? 'sayphoto-task-' : 'sayphoto-preview-task-';
export function useTaskState<T>(key: string, initial: T) {
 const [value, setValue] = useState<T>(() => readSaved<T>(prefix + key, initial));
 useEffect(() => saveLocal(prefix + key, value), [key, value]);
 return [value, setValue] as const;
}
