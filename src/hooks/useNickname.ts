import { useSyncExternalStore } from 'react';
import { readNickname, subscribeNickname } from '../services/nickname';

export function useNickname() {
  return useSyncExternalStore(subscribeNickname, readNickname, () => '');
}
