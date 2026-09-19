import { Global, Module } from "@nestjs/common";
import { LibraryCryptoService } from "./library-crypto.service.js";
import { LibraryKeyService } from "./library-key.service.js";

@Global()
@Module({
  providers: [LibraryCryptoService, LibraryKeyService],
  exports: [LibraryCryptoService, LibraryKeyService],
})
export class LibraryCryptoModule {}
