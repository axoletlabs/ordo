import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";

const TTL_MS = 30_000;

interface Cached {
  addresses: LookupAddress[];
  expiresAt: number;
}

type NodeLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Short-lived DNS cache so SSRF checks and fetch do not resolve twice per hop. */
export class DnsCache {
  private readonly entries = new Map<string, Cached>();

  async lookupAll(hostname: string): Promise<LookupAddress[]> {
    const key = hostname.toLowerCase();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.addresses;
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    const ipv4First = [...addresses].sort((a, b) => a.family - b.family);
    this.entries.set(key, { addresses: ipv4First, expiresAt: Date.now() + TTL_MS });
    if (this.entries.size > 2_000) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
    return ipv4First;
  }

  /** Node/undici `lookup` that reuses this cache and prefers IPv4. */
  asLookup() {
    return (
      hostname: string,
      options: LookupOptions | NodeLookupCallback,
      callback?: NodeLookupCallback,
    ) => {
      const cb = typeof options === "function" ? options : callback;
      const opts = typeof options === "function" ? undefined : options;
      if (!cb) return;
      void this.lookupAll(hostname).then(
        (addresses) => {
          if (addresses.length === 0) {
            const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
              code: "ENOTFOUND",
            }) as NodeJS.ErrnoException;
            cb(err, "", 4);
            return;
          }
          if (opts?.all) {
            cb(null, addresses);
            return;
          }
          const first = addresses[0]!;
          cb(null, first.address, first.family);
        },
        (err: NodeJS.ErrnoException) => cb(err, "", 4),
      );
    };
  }
}
