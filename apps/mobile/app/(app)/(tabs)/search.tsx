/** Preserve old search links; search itself lives in the library. */
import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";
import { sanitizeRouteParam } from "../../../src/lib/search-bookmarks";

export default function SearchRedirect() {
  const params = useLocalSearchParams<{ query?: string; bookmark?: string }>();
  return <Redirect href={{ pathname: "/", params: {
    query: sanitizeRouteParam(params.query), bookmark: sanitizeRouteParam(params.bookmark), focus: "1",
  } }} />;
}
