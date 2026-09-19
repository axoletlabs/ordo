import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  decryptText,
  encryptText,
  generateDek,
  generateKdfSalt,
  generateRecoveryKey,
  isLibraryCiphertext,
  normalizeRecoveryKey,
  unwrapDekWithPassword,
  unwrapDekWithRecoveryKey,
  unwrapDekWithToken,
  unwrapMfaDekStash,
  wrapDekWithPassword,
  wrapDekWithRecoveryKey,
  wrapDekWithToken,
  wrapMfaDekStash,
  type MfaDekStash,
} from "./library-crypto.js";
import {
  openBookmark,
  openFolder,
  openHighlight,
  openImportJob,
  openTag,
  sealBookmark,
  sealFolderName,
  sealHighlight,
  sealImportJob,
  sealTag,
  tagIndexValue,
} from "./library-fields.js";

interface CryptoStore {
  dek: Buffer | null;
}

@Injectable()
export class LibraryCryptoService {
  private readonly als = new AsyncLocalStorage<CryptoStore>();

  snapshot(): Buffer | null {
    const dek = this.currentDek();
    return dek ? Buffer.from(dek) : null;
  }

  currentDek(): Buffer | null {
    return this.als.getStore()?.dek ?? null;
  }

  active(dek = this.currentDek()): boolean {
    return dek != null && dek.length > 0;
  }

  run<T>(dek: Buffer | null, fn: () => T): T {
    return this.als.run({ dek }, fn);
  }

  runAsync<T>(dek: Buffer | null, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ dek }, fn);
  }

  encryptText(plaintext: string, aad: string, dek = this.currentDek()): string {
    if (!dek) return plaintext;
    if (isLibraryCiphertext(plaintext)) return plaintext;
    return encryptText(dek, plaintext, aad);
  }

  decryptText(value: string, aad: string, dek = this.currentDek()): string {
    return decryptText(dek, value, aad);
  }

  sealBookmark<T extends Record<string, unknown>>(userId: string, id: string, row: T, dek = this.currentDek()): T {
    return sealBookmark(dek, userId, id, row);
  }

  openBookmark<T extends Record<string, unknown>>(row: T, dek = this.currentDek()): T {
    return openBookmark(dek, row);
  }

  sealFolderName(userId: string, id: string, name: string, dek = this.currentDek()): string {
    return sealFolderName(dek, userId, id, name);
  }

  openFolder<T extends object>(row: T, dek = this.currentDek()): T {
    return openFolder(dek, row as Record<string, unknown>) as T;
  }

  sealTag<T extends { name: string; normalizedName?: string }>(
    userId: string,
    id: string,
    row: T,
    dek = this.currentDek(),
  ): T & { name: string; normalizedName: string } {
    return sealTag(dek, userId, id, row);
  }

  openTag<T extends Record<string, unknown>>(row: T, dek = this.currentDek()): T {
    return openTag(dek, row);
  }

  tagIndex(userId: string, name: string, dek = this.currentDek()): string {
    return tagIndexValue(dek, userId, name);
  }

  sealHighlight<T extends Record<string, unknown>>(
    userId: string,
    id: string,
    row: T,
    dek = this.currentDek(),
  ): T {
    return sealHighlight(dek, userId, id, row);
  }

  openHighlight<T extends Record<string, unknown>>(userId: string, row: T, dek = this.currentDek()): T {
    return openHighlight(dek, userId, row);
  }

  sealImportJob<T extends Record<string, unknown>>(
    userId: string,
    id: string,
    row: T,
    dek = this.currentDek(),
  ): T {
    return sealImportJob(dek, userId, id, row);
  }

  openImportJob<T extends Record<string, unknown>>(row: T, dek = this.currentDek()): T {
    return openImportJob(dek, row);
  }

  newId(): string {
    return randomUUID();
  }

  wrapForSession(dek: Buffer, tokens: { accessToken: string; refreshToken: string }) {
    return {
      dekWrapped: wrapDekWithToken(dek, tokens.accessToken, "access"),
      dekRefreshWrapped: wrapDekWithToken(dek, tokens.refreshToken, "refresh"),
    };
  }

  unwrapAccess(wrapped: string, accessToken: string): Buffer {
    return unwrapDekWithToken(wrapped, accessToken, "access");
  }

  unwrapRefresh(wrapped: string, refreshToken: string): Buffer {
    return unwrapDekWithToken(wrapped, refreshToken, "refresh");
  }

  wrapMfaStash(challengeToken: string, stash: MfaDekStash): string {
    return wrapMfaDekStash(challengeToken, stash);
  }

  unwrapMfaStash(challengeToken: string, packed: string): MfaDekStash {
    return unwrapMfaDekStash(challengeToken, packed);
  }

  async wrapPassword(dek: Buffer, password: string, salt: string): Promise<string> {
    return wrapDekWithPassword(dek, password, salt);
  }

  async unwrapPassword(wrapped: string, password: string, salt: string): Promise<Buffer> {
    return unwrapDekWithPassword(wrapped, password, salt);
  }

  async wrapRecovery(dek: Buffer, recoveryKey: string): Promise<string> {
    return wrapDekWithRecoveryKey(dek, recoveryKey);
  }

  async unwrapRecovery(wrapped: string, recoveryKey: string): Promise<Buffer> {
    return unwrapDekWithRecoveryKey(wrapped, normalizeRecoveryKey(recoveryKey));
  }

  generateDek(): Buffer {
    return generateDek();
  }

  generateRecoveryKey(): string {
    return generateRecoveryKey();
  }

  generateKdfSalt(): string {
    return generateKdfSalt();
  }
}
