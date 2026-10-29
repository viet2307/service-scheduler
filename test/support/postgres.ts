import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export const POSTGRES_IMAGE = 'postgres:18.4-alpine3.24';

const holder = globalThis as { postgresContainer?: StartedPostgreSqlContainer };

export const setContainer = (container: StartedPostgreSqlContainer) => {
  holder.postgresContainer = container;
};

export const getContainer = () => holder.postgresContainer;
