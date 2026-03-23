declare module "*ismrmrd_wasm_writer.js" {
  const createModule: (options?: Record<string, unknown>) => Promise<any>;
  export default createModule;
}
