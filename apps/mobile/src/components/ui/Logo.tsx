/**
 * Ordo brand mark for in-app branding (e.g. the auth screens). Uses a tight
 * crop of the transparent logo so the coral mark sits compactly on the themed
 * background. Height follows the asset's aspect ratio from the given width.
 */
import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { APP_NAME } from "@ordo/shared";
import LOGO_MARK from "../../../assets/logo-mark.png";

const ASPECT = 468 / 509;
export const AUTH_LOGO_WIDTH = 40;
export const SPLASH_LOGO_WIDTH = 120;

export interface LogoProps {
  /** Rendered width in dp; height follows the mark's aspect ratio. */
  width?: number;
}

export function Logo({ width = AUTH_LOGO_WIDTH }: LogoProps) {
  return (
    <View style={[styles.frame, { width, height: width / ASPECT }]}>
      <Image
        source={LOGO_MARK}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel={APP_NAME}
        accessibilityRole="image"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: "center",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
});
