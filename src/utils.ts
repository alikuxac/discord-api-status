export function cast<T>(value: unknown): T {
    return value as T;
}

export async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}