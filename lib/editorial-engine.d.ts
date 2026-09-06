/* oxlint-disable typescript/no-explicit-any */
export function addDays(value: string | Date, days: number): string;
export function mondayOfWeek(value: string | Date): string;
export function generateSchedule(input: Record<string, unknown>): { posts: any[]; tasks: any[] };
export function movePost(posts: any[], tasks: any[], postId: string, plannedDate: string): { posts: any[]; tasks: any[] };
export function postingDensity(posts: any[]): Record<string, { week: string; count: number; level: 'ok' | 'full' | 'conflict' }>;
export function blockReasons(itemId: string, posts: any[], materials: any[]): string[];
export function matchesFilters(record: any, filters: Record<string, string>): boolean;
export function reassignTask(tasks: any[], taskId: string, owner: string): any[];
