export * from '@school-bus-tracking/shared-types';

export interface WebPageProps {
  params?: Record<string, string>;
  searchParams?: Record<string, string | string[] | undefined>;
}
