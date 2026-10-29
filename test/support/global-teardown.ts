import { getContainer } from './postgres';

export default async function globalTeardown(): Promise<void> {
  await getContainer()?.stop();
}
