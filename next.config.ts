import type { NextConfig } from "next";

const config: NextConfig = {
  // Allow isolated verification while another local preview is running.
  distDir: process.env.AEGIS_BUILD_DIR || ".next",
};

export default config;
