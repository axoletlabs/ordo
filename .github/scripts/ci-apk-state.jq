# One state for both the single-APK path and the ABI/assembly path. A skipped
# build_apk does not mean a release matrix has stopped producing a binary.
def publishing: .name == "build_apk" or .name == "assemble_release";
def apk: publishing or (.name | startswith("build_abi"));
def active: .status != "completed";
def failed: .status == "completed" and
  (.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral");
if any(.[]; publishing and .status == "completed" and .conclusion == "success") then "built"
elif any(.[]; apk and active) then "building"
elif any(.[]; (.name == "detect" or .name == "analyze" or .name == "supply-chain" or apk) and failed) then "failed"
elif any(.[]; .name == "detect" and active) then "deciding"
elif any(.[]; .name == "assemble_release" and .status == "completed") and
     any(.[]; .name == "build_apk" and .status == "completed") then "no-apk"
elif any(.[]; .name | startswith("build_abi")) then "building"
else "deciding"
end
