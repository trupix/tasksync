import fs from "fs";
import { ClineProvider } from "./cline";
import { RooProvider } from "./roo";
import { KiloProvider } from "./kilo";
import { OpenClawProvider } from "./openclaw";
import { CapturedProvider } from "./captured";
import { IProvider, ProviderRoot } from "./interface";

export interface ProviderTarget {
  provider: IProvider;
  root: ProviderRoot;
}

export function createProviderRegistry(): IProvider[] {
  return [
    new ClineProvider(),
    new RooProvider(),
    new KiloProvider(),
    new OpenClawProvider(),
    new CapturedProvider(),
  ];
}

export function getProviderByName(
  name: string,
  providers: IProvider[] = createProviderRegistry()
): IProvider | undefined {
  return providers.find((provider) => provider.getProviderName() === name.toLowerCase());
}

export function isAccessibleRootPath(rootPath: string): boolean {
  try {
    fs.accessSync(rootPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function getAccessibleRoots(provider: IProvider): ProviderRoot[] {
  // Use provider.validateRoot as the OR condition so providers that manage
  // their own storage lifecycle (e.g. CapturedProvider) are included even
  // before their directory has been created on disk for the first time.
  return provider.getRoots().filter(
    (root) => isAccessibleRootPath(root.path) || provider.validateRoot(root.path)
  );
}

export function detectAllTargets(providers: IProvider[] = createProviderRegistry()): ProviderTarget[] {
  const targets: ProviderTarget[] = [];

  for (const provider of providers) {
    for (const root of getAccessibleRoots(provider)) {
      targets.push({ provider, root });
    }
  }

  return targets;
}