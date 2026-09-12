# Drop build-only metadata so JS follow-ups still OTA onto older APKs.
# extra.ordo is the git stamp. packageJson:scripts lists test files.
# New builds skip both via fingerprint.config.js; this keeps detect from
# minting an APK when comparing to older binaries that still hashed them.
del(.hash)
| .sources |= map(select(.id != "packageJson:scripts"))
| .sources |= map(
    if .type == "contents" and .id == "expoConfig" then
      .contents |= (fromjson | del(.extra.ordo) | tojson)
      | del(.hash)
    else
      .
    end
  )
