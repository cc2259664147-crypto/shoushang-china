import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AdminError } from '../database';
let active = 0;
export function opaque(): string { return randomBytes(32).toString('base64url'); }
export function csrf(token: string): string { return createHmac('sha256', token).update('shoushang-admin-csrf-v1').digest('base64url'); }
export function equal(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
function validPassword(password: string) { if (password.length < 12 || password.length > 128 || /^(password|admin|123456|qwerty|letmein)/iu.test(password))
    throw new AdminError('INVALID_INPUT', '密码须为12～128字符且不能使用常见弱口令'); }
async function derive(password: string, salt: Buffer): Promise<Buffer> {
    if (active >= 2)
        throw new AdminError('RATE_LIMITED', '登录繁忙，请稍后重试');
    active++;
    try {
        return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (err, result) => err ? reject(err) : resolve(result)));
    }
    finally {
        active--;
    }
}
export async function hashPassword(password: string): Promise<string> { validPassword(password); const salt = randomBytes(16); return `scrypt$131072$8$1$${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`; }
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
    const parts = stored?.split('$');
    const valid = parts?.length === 6 && parts[0] === 'scrypt' && parts[1] === '131072' && parts[2] === '8' && parts[3] === '1' && /^[a-f0-9]{32}$/u.test(parts[4] ?? '') && /^[a-f0-9]{128}$/u.test(parts[5] ?? '');
    const calculated = await derive(password, valid ? Buffer.from(parts![4]!, 'hex') : Buffer.alloc(16, 0x47));
    const target = valid ? Buffer.from(parts![5]!, 'hex') : Buffer.alloc(64);
    return timingSafeEqual(calculated, target) && !!valid;
}
export interface SecurityConfig {
    origin: string;
    securityMode: 'https' | 'loopback-http';
    listenHost: string;
}
const isLoopback = (address: string) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
export function validateSecurity(config: SecurityConfig): void {
    const origin = new URL(config.origin);
    if (origin.origin !== config.origin || origin.username || origin.password)
        throw new Error('An exact trusted origin is required');
    if (config.securityMode === 'loopback-http') {
        if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname) || !isLoopback(config.listenHost))
            throw new Error('loopback-http requires an explicit loopback origin and listenHost');
    }
    else if (config.securityMode !== 'https' || origin.protocol !== 'https:')
        throw new Error('Production requires HTTPS');
}
export function assertAdminListener(app: FastifyInstance, config: SecurityConfig): void {
    validateSecurity(config);
    if (config.securityMode === 'loopback-http') {
        const address = app.server.address();
        if (!address || typeof address === 'string' || !isLoopback(address.address))
            throw new AdminError('FORBIDDEN', '本地调试必须实际监听回环地址');
    }
}
export function cookieName(config: SecurityConfig): string { return config.securityMode === 'https' ? '__Secure-shoushang_admin' : 'shoushang_admin_dev'; }
export function cookie(config: SecurityConfig, name: string, value: string, seconds: number): string { return `${name}=${value}; Path=/api/v1/admin; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.securityMode === 'https' ? '; Secure' : ''}`; }
export function readCookie(header: string | undefined, name: string): string | null {
    const values = (header ?? '').split(';').map(s => s.trim()).filter(s => s.startsWith(`${name}=`));
    if (values.length !== 1)
        return null;
    const token = values[0]!.slice(name.length + 1);
    return /^[a-zA-Z0-9_-]{43}$/u.test(token) ? token : null;
}
