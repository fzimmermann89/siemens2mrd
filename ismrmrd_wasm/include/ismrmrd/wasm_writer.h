#pragma once
#ifndef ISMRMRD_WASM_WRITER_H
#define ISMRMRD_WASM_WRITER_H

#include "ismrmrd/dataset.h"

#define ISMRMRD_WASM_ACQUISITION_HEADER_SIZE 340
#define ISMRMRD_WASM_WAVEFORM_HEADER_SIZE 40

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ISMRMRD_WasmDatasetWriter ISMRMRD_WasmDatasetWriter;

EXPORTISMRMRD ISMRMRD_WasmDatasetWriter *ismrmrdshim_open_dataset(
    const char *filename, const char *groupname);
EXPORTISMRMRD ISMRMRD_WasmDatasetWriter *ismrmrdshim_create_dataset(
    const char *filename, const char *groupname);
EXPORTISMRMRD int ismrmrdshim_close_dataset(ISMRMRD_WasmDatasetWriter *writer);
EXPORTISMRMRD void ismrmrdshim_destroy_dataset(ISMRMRD_WasmDatasetWriter *writer);
EXPORTISMRMRD int ismrmrdshim_flush_dataset(ISMRMRD_WasmDatasetWriter *writer);
EXPORTISMRMRD int ismrmrdshim_write_header(
    ISMRMRD_WasmDatasetWriter *writer, const char *xmlstring);
EXPORTISMRMRD char *ismrmrdshim_read_header(ISMRMRD_WasmDatasetWriter *writer);
EXPORTISMRMRD uint32_t ismrmrdshim_get_number_of_acquisitions(
    ISMRMRD_WasmDatasetWriter *writer);
EXPORTISMRMRD int ismrmrdshim_append_acquisition(
    ISMRMRD_WasmDatasetWriter *writer,
    const ISMRMRD_AcquisitionHeader *header,
    const float *trajectory,
    const complex_float_t *data);
EXPORTISMRMRD int ismrmrdshim_read_acquisition(
    ISMRMRD_WasmDatasetWriter *writer,
    uint32_t index,
    ISMRMRD_AcquisitionHeader *header,
    float *trajectory,
    uint32_t trajectory_capacity,
    uint32_t *trajectory_length);
EXPORTISMRMRD int ismrmrdshim_append_waveform(
    ISMRMRD_WasmDatasetWriter *writer,
    const ISMRMRD_WaveformHeader *header,
    const uint32_t *data);
EXPORTISMRMRD const char *ismrmrdshim_get_last_error(void);

#ifdef __cplusplus
}
#endif

#endif
