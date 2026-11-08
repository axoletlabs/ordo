import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { from, lastValueFrom, type Observable } from "rxjs";
import type { AuthenticatedRequest } from "../common/decorators/current-user.decorator.js";
import { ExtractionService } from "../bookmarks/extraction.service.js";
import { LibraryCryptoService } from "./library-crypto.service.js";
import { LibraryKeyService } from "./library-key.service.js";

/**
 * Keeps the request-scoped data-encryption key in AsyncLocalStorage for the
 * whole handler (and only the handler). Background work must snapshot the DEK.
 *
 * Sessions minted before the account's library key existed carry no wrapped
 * DEK. Hydrating those from the server wrap keeps them encrypting/decrypting
 * the same way as fresh sessions instead of writing plaintext into an
 * already-migrated library.
 */
@Injectable()
export class LibraryCryptoInterceptor implements NestInterceptor {
  constructor(
    private readonly crypto: LibraryCryptoService,
    private readonly extraction: ExtractionService,
    private readonly keys: LibraryKeyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionDek = req.user?.dek ?? null;
    const userId = req.user?.userId;
    return from(
      (async () => {
        const handle = async () => {
          const dek = this.crypto.snapshot();
          if (userId && dek) await this.keys.ensureServerWrap(userId, dek);
          if (userId) this.extraction.resumePending(userId, dek);
          return lastValueFrom(next.handle(), { defaultValue: undefined });
        };
        return userId ? this.keys.runWithCurrentKey(userId, sessionDek, handle)
          : this.crypto.runAsync(null, handle);
      })(),
    );
  }
}
