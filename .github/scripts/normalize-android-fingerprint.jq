# Drop build-only metadata so JS follow-ups still OTA onto older APKs.
# extra.ordo is the git stamp. packageJson:scripts lists test files and
# must not mint a new runtime (that strands every previously shipped APK).
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
