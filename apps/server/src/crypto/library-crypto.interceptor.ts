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
    const dek = req.user?.dek ?? null;
    const userId = req.user?.userId;
    return from(
      this.crypto.runAsync(dek, async () => {
        if (userId && dek) await this.keys.ensureServerWrap(userId, dek);
        if (userId) this.extraction.resumePending(userId, dek);
        return lastValueFrom(next.handle(), { defaultValue: undefined });
      }),
    );
  }
}
