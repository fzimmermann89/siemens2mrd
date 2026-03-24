#include "ismrmrd/wasm_writer.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct ISMRMRD_WasmDatasetWriter {
    ISMRMRD_Dataset dataset;
    int is_open;
};

static char ismrmrdshim_last_error[4096];

static void ismrmrdshim_clear_last_error(void) {
    ismrmrdshim_last_error[0] = '\0';
}

static void ismrmrdshim_capture_errors(const char *fallback_message) {
    char *file = NULL;
    char *func = NULL;
    char *msg = NULL;
    int line = 0;
    int code = 0;
    size_t offset = 0;
    int saw_error = 0;

    ismrmrdshim_clear_last_error();

    while (ismrmrd_pop_error(&file, &line, &func, &code, &msg)) {
        int written;
        saw_error = 1;
        written = snprintf(
            ismrmrdshim_last_error + offset,
            sizeof(ismrmrdshim_last_error) - offset,
            "%sISMRMRD %s in %s (%s:%d): %s",
            offset ? "\n" : "",
            ismrmrd_strerror(code),
            func ? func : "<unknown>",
            file ? file : "<unknown>",
            line,
            msg ? msg : "<no message>");
        if (written < 0) {
            break;
        }
        if ((size_t)written >= sizeof(ismrmrdshim_last_error) - offset) {
            offset = sizeof(ismrmrdshim_last_error) - 1;
            break;
        }
        offset += (size_t)written;
    }

    if (!saw_error && fallback_message != NULL) {
        snprintf(ismrmrdshim_last_error, sizeof(ismrmrdshim_last_error), "%s", fallback_message);
    }
}

static int ismrmrdshim_validate_writer(ISMRMRD_WasmDatasetWriter *writer) {
    if (writer == NULL) {
        ismrmrdshim_capture_errors("writer is null");
        return ISMRMRD_RUNTIMEERROR;
    }
    if (!writer->is_open) {
        ismrmrdshim_capture_errors("writer is closed");
        return ISMRMRD_RUNTIMEERROR;
    }
    ismrmrdshim_clear_last_error();
    return ISMRMRD_NOERROR;
}

static char *ismrmrdshim_make_path(const ISMRMRD_Dataset *dataset, const char *leaf) {
    size_t groupname_length;
    size_t leaf_length;
    char *path;

    if (dataset == NULL || dataset->groupname == NULL || leaf == NULL) {
        return NULL;
    }

    groupname_length = strlen(dataset->groupname);
    leaf_length = strlen(leaf);
    path = (char *)malloc(groupname_length + leaf_length + 2);
    if (path == NULL) {
        return NULL;
    }

    memcpy(path, dataset->groupname, groupname_length);
    path[groupname_length] = '/';
    memcpy(path + groupname_length + 1, leaf, leaf_length);
    path[groupname_length + leaf_length + 1] = '\0';
    return path;
}

static char *ismrmrdshim_read_xml_header(const ISMRMRD_Dataset *dataset) {
    char *path = NULL;
    char *xmlstring = NULL;
    hid_t header_dataset = H5I_INVALID_HID;
    hid_t datatype = H5I_INVALID_HID;
    herr_t h5status;

    if (dataset == NULL) {
        ismrmrdshim_capture_errors("dataset is null");
        return NULL;
    }

    path = ismrmrdshim_make_path(dataset, "xml");
    if (path == NULL) {
        ismrmrdshim_capture_errors("failed to allocate xml path");
        return NULL;
    }

    header_dataset = H5Dopen2(dataset->fileid, path, H5P_DEFAULT);
    if (header_dataset < 0) {
        ismrmrdshim_capture_errors("failed to open xml dataset");
        goto cleanup;
    }

    datatype = H5Dget_type(header_dataset);
    if (datatype < 0) {
        ismrmrdshim_capture_errors("failed to get xml datatype");
        goto cleanup;
    }

    h5status = H5Dread(header_dataset, datatype, H5S_ALL, H5S_ALL, H5P_DEFAULT, &xmlstring);
    if (h5status < 0 || xmlstring == NULL) {
        ismrmrdshim_capture_errors("failed to read xml header");
        free(xmlstring);
        xmlstring = NULL;
        goto cleanup;
    }

cleanup:
    if (datatype >= 0) {
        H5Tclose(datatype);
    }
    if (header_dataset >= 0) {
        H5Dclose(header_dataset);
    }
    free(path);
    return xmlstring;
}

static ISMRMRD_WasmDatasetWriter *ismrmrdshim_open_dataset_internal(
    const char *filename,
    const char *groupname,
    int create_if_needed) {
    ISMRMRD_WasmDatasetWriter *writer;
    int status;

    ismrmrdshim_clear_last_error();

    if (filename == NULL || groupname == NULL) {
        ismrmrdshim_capture_errors("filename and groupname are required");
        return NULL;
    }

    writer = (ISMRMRD_WasmDatasetWriter *)calloc(1, sizeof(*writer));
    if (writer == NULL) {
        ismrmrdshim_capture_errors("failed to allocate dataset writer");
        return NULL;
    }

    status = ismrmrd_init_dataset(&writer->dataset, filename, groupname);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to initialize dataset");
        free(writer);
        return NULL;
    }

    status = ismrmrd_open_dataset(&writer->dataset, create_if_needed);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to open dataset");
        ismrmrd_close_dataset(&writer->dataset);
        free(writer);
        return NULL;
    }

    writer->is_open = 1;
    return writer;
}

ISMRMRD_WasmDatasetWriter *ismrmrdshim_create_dataset(
    const char *filename, const char *groupname) {
    return ismrmrdshim_open_dataset_internal(filename, groupname, 1);
}

ISMRMRD_WasmDatasetWriter *ismrmrdshim_open_dataset(
    const char *filename, const char *groupname) {
    return ismrmrdshim_open_dataset_internal(filename, groupname, 0);
}

int ismrmrdshim_close_dataset(ISMRMRD_WasmDatasetWriter *writer) {
    int status;

    if (writer == NULL) {
        ismrmrdshim_capture_errors("writer is null");
        return ISMRMRD_RUNTIMEERROR;
    }
    if (!writer->is_open) {
        ismrmrdshim_clear_last_error();
        return ISMRMRD_NOERROR;
    }

    status = ismrmrd_close_dataset(&writer->dataset);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to close dataset");
        return status;
    }

    writer->is_open = 0;
    ismrmrdshim_clear_last_error();
    return ISMRMRD_NOERROR;
}

void ismrmrdshim_destroy_dataset(ISMRMRD_WasmDatasetWriter *writer) {
    if (writer == NULL) {
        return;
    }

    if (writer->is_open) {
        ismrmrdshim_close_dataset(writer);
    }

    free(writer);
}

int ismrmrdshim_flush_dataset(ISMRMRD_WasmDatasetWriter *writer) {
    herr_t h5status;

    if (ismrmrdshim_validate_writer(writer) != ISMRMRD_NOERROR) {
        return ISMRMRD_RUNTIMEERROR;
    }

    h5status = H5Fflush(writer->dataset.fileid, H5F_SCOPE_GLOBAL);
    if (h5status < 0) {
        ismrmrdshim_capture_errors("failed to flush dataset");
        return ISMRMRD_HDF5ERROR;
    }

    return ISMRMRD_NOERROR;
}

int ismrmrdshim_write_header(ISMRMRD_WasmDatasetWriter *writer, const char *xmlstring) {
    int status;

    if (ismrmrdshim_validate_writer(writer) != ISMRMRD_NOERROR) {
        return ISMRMRD_RUNTIMEERROR;
    }

    status = ismrmrd_write_header(&writer->dataset, xmlstring);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to write xml header");
        return status;
    }

    return ISMRMRD_NOERROR;
}

char *ismrmrdshim_read_header(ISMRMRD_WasmDatasetWriter *writer) {
    char *xmlstring;

    if (ismrmrdshim_validate_writer(writer) != ISMRMRD_NOERROR) {
        return NULL;
    }

    xmlstring = ismrmrdshim_read_xml_header(&writer->dataset);
    if (xmlstring == NULL) {
        return NULL;
    }

    ismrmrdshim_clear_last_error();
    return xmlstring;
}

uint32_t ismrmrdshim_get_number_of_acquisitions(ISMRMRD_WasmDatasetWriter *writer) {
    if (ismrmrdshim_validate_writer(writer) != ISMRMRD_NOERROR) {
        return 0;
    }
    return ismrmrd_get_number_of_acquisitions(&writer->dataset);
}

uint32_t ismrmrdshim_get_number_of_waveforms(ISMRMRD_WasmDatasetWriter *writer) {
    if (ismrmrdshim_validate_writer(writer) != ISMRMRD_NOERROR) {
        return 0;
    }
    return ismrmrd_get_number_of_waveforms(&writer->dataset);
}

int ismrmrdshim_append_acquisition(
    ISMRMRD_WasmDatasetWriter *writer,
    const ISMRMRD_AcquisitionHeader *header,
    const float *trajectory,
    const complex_float_t *data) {
    ISMRMRD_Acquisition acquisition;
    size_t trajectory_size;
    size_t data_size;
    int status;

    if (ismrmrdshim_validate_writer(writer) != ISMRMRD_NOERROR) {
        return ISMRMRD_RUNTIMEERROR;
    }
    if (header == NULL) {
        ismrmrdshim_capture_errors("acquisition header is null");
        return ISMRMRD_RUNTIMEERROR;
    }

    status = ismrmrd_init_acquisition(&acquisition);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to initialize acquisition");
        return status;
    }

    memcpy(&acquisition.head, header, sizeof(*header));
    status = ismrmrd_make_consistent_acquisition(&acquisition);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to size acquisition buffers");
        ismrmrd_cleanup_acquisition(&acquisition);
        return status;
    }

    trajectory_size = ismrmrd_size_of_acquisition_traj(&acquisition);
    data_size = ismrmrd_size_of_acquisition_data(&acquisition);

    if (trajectory_size > 0 && trajectory == NULL) {
        ismrmrdshim_capture_errors("trajectory buffer is null");
        ismrmrd_cleanup_acquisition(&acquisition);
        return ISMRMRD_RUNTIMEERROR;
    }
    if (data_size > 0 && data == NULL) {
        ismrmrdshim_capture_errors("acquisition data buffer is null");
        ismrmrd_cleanup_acquisition(&acquisition);
        return ISMRMRD_RUNTIMEERROR;
    }

    if (trajectory_size > 0) {
        memcpy(acquisition.traj, trajectory, trajectory_size);
    }
    if (data_size > 0) {
        memcpy(acquisition.data, data, data_size);
    }

    status = ismrmrd_append_acquisition(&writer->dataset, &acquisition);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to append acquisition");
    }

    ismrmrd_cleanup_acquisition(&acquisition);
    return status;
}

int ismrmrdshim_read_acquisition(
    ISMRMRD_WasmDatasetWriter *writer,
    uint32_t index,
    ISMRMRD_AcquisitionHeader *header,
    float *trajectory,
    uint32_t trajectory_capacity,
    uint32_t *trajectory_length) {
    ISMRMRD_Acquisition acquisition;
    size_t trajectory_size;
    uint32_t required_length;
    int status;

    if (ismrmrdshim_validate_writer(writer) != ISMRMRD_NOERROR) {
        return ISMRMRD_RUNTIMEERROR;
    }
    if (header == NULL) {
        ismrmrdshim_capture_errors("acquisition header output is null");
        return ISMRMRD_RUNTIMEERROR;
    }

    status = ismrmrd_init_acquisition(&acquisition);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to initialize acquisition");
        return status;
    }

    status = ismrmrd_read_acquisition(&writer->dataset, index, &acquisition);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to read acquisition");
        ismrmrd_cleanup_acquisition(&acquisition);
        return status;
    }

    memcpy(header, &acquisition.head, sizeof(*header));
    trajectory_size = ismrmrd_size_of_acquisition_traj(&acquisition);
    required_length = (uint32_t)(trajectory_size / sizeof(float));

    if (trajectory_length != NULL) {
        *trajectory_length = required_length;
    }

    if (required_length > 0 && trajectory != NULL) {
        if (trajectory_capacity < required_length) {
            ismrmrdshim_capture_errors("trajectory output buffer is too small");
            ismrmrd_cleanup_acquisition(&acquisition);
            return ISMRMRD_RUNTIMEERROR;
        }
        memcpy(trajectory, acquisition.traj, trajectory_size);
    }

    ismrmrd_cleanup_acquisition(&acquisition);
    ismrmrdshim_clear_last_error();
    return ISMRMRD_NOERROR;
}

int ismrmrdshim_append_waveform(
    ISMRMRD_WasmDatasetWriter *writer,
    const ISMRMRD_WaveformHeader *header,
    const uint32_t *data) {
    ISMRMRD_Waveform waveform;
    size_t data_size;
    int status;

    if (ismrmrdshim_validate_writer(writer) != ISMRMRD_NOERROR) {
        return ISMRMRD_RUNTIMEERROR;
    }
    if (header == NULL) {
        ismrmrdshim_capture_errors("waveform header is null");
        return ISMRMRD_RUNTIMEERROR;
    }

    status = ismrmrd_init_waveform(&waveform);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to initialize waveform");
        return status;
    }

    memcpy(&waveform.head, header, sizeof(*header));
    status = ismrmrd_make_consistent_waveform(&waveform);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to size waveform buffer");
        free(waveform.data);
        return status;
    }

    data_size = (size_t)ismrmrd_size_of_waveform_data(&waveform);
    if (data_size > 0 && data == NULL) {
        ismrmrdshim_capture_errors("waveform data buffer is null");
        free(waveform.data);
        return ISMRMRD_RUNTIMEERROR;
    }

    if (data_size > 0) {
        memcpy(waveform.data, data, data_size);
    }

    status = ismrmrd_append_waveform(&writer->dataset, &waveform);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to append waveform");
    }

    free(waveform.data);
    return status;
}

static int ismrmrdshim_copy_waveforms(
    ISMRMRD_WasmDatasetWriter *source_writer,
    ISMRMRD_WasmDatasetWriter *dest_writer) {
    uint32_t waveform_count;
    uint32_t index;

    waveform_count = ismrmrd_get_number_of_waveforms(&source_writer->dataset);
    for (index = 0; index < waveform_count; index++) {
        ISMRMRD_Waveform waveform;
        int status;

        ismrmrd_init_waveform(&waveform);
        status = ismrmrd_read_waveform(&source_writer->dataset, index, &waveform);
        if (status != ISMRMRD_NOERROR) {
            ismrmrdshim_capture_errors("failed to read waveform");
            free(waveform.data);
            return status;
        }

        status = ismrmrd_append_waveform(&dest_writer->dataset, &waveform);
        free(waveform.data);
        if (status != ISMRMRD_NOERROR) {
            ismrmrdshim_capture_errors("failed to append waveform");
            return status;
        }
    }

    return ISMRMRD_NOERROR;
}

static int ismrmrdshim_copy_acquisitions(
    ISMRMRD_WasmDatasetWriter *source_writer,
    ISMRMRD_WasmDatasetWriter *meta_writer,
    ISMRMRD_WasmDatasetWriter *dest_writer) {
    uint32_t acquisition_count;
    uint32_t index;

    acquisition_count = ismrmrd_get_number_of_acquisitions(&source_writer->dataset);
    if (meta_writer != NULL) {
      uint32_t meta_acquisition_count = ismrmrd_get_number_of_acquisitions(&meta_writer->dataset);
      if (meta_acquisition_count != acquisition_count) {
          ismrmrdshim_capture_errors("meta dataset acquisition count does not match source dataset");
          return ISMRMRD_RUNTIMEERROR;
      }
    }

    for (index = 0; index < acquisition_count; index++) {
        ISMRMRD_Acquisition acquisition;
        int status;

        status = ismrmrd_init_acquisition(&acquisition);
        if (status != ISMRMRD_NOERROR) {
            ismrmrdshim_capture_errors("failed to initialize acquisition");
            return status;
        }

        status = ismrmrd_read_acquisition(&source_writer->dataset, index, &acquisition);
        if (status != ISMRMRD_NOERROR) {
            ismrmrdshim_capture_errors("failed to read acquisition");
            ismrmrd_cleanup_acquisition(&acquisition);
            return status;
        }

        if (meta_writer != NULL) {
            ISMRMRD_Acquisition meta_acquisition;
            size_t trajectory_size;

            status = ismrmrd_init_acquisition(&meta_acquisition);
            if (status != ISMRMRD_NOERROR) {
                ismrmrdshim_capture_errors("failed to initialize meta acquisition");
                ismrmrd_cleanup_acquisition(&acquisition);
                return status;
            }

            status = ismrmrd_read_acquisition(&meta_writer->dataset, index, &meta_acquisition);
            if (status != ISMRMRD_NOERROR) {
                ismrmrdshim_capture_errors("failed to read meta acquisition");
                ismrmrd_cleanup_acquisition(&meta_acquisition);
                ismrmrd_cleanup_acquisition(&acquisition);
                return status;
            }

            if (acquisition.head.number_of_samples != meta_acquisition.head.number_of_samples) {
                ismrmrdshim_capture_errors("meta acquisition sample count does not match source acquisition");
                ismrmrd_cleanup_acquisition(&meta_acquisition);
                ismrmrd_cleanup_acquisition(&acquisition);
                return ISMRMRD_RUNTIMEERROR;
            }

            acquisition.head.trajectory_dimensions = meta_acquisition.head.trajectory_dimensions;
            status = ismrmrd_make_consistent_acquisition(&acquisition);
            if (status != ISMRMRD_NOERROR) {
                ismrmrdshim_capture_errors("failed to resize acquisition trajectory");
                ismrmrd_cleanup_acquisition(&meta_acquisition);
                ismrmrd_cleanup_acquisition(&acquisition);
                return status;
            }

            trajectory_size = ismrmrd_size_of_acquisition_traj(&meta_acquisition);
            if (trajectory_size > 0) {
                memcpy(acquisition.traj, meta_acquisition.traj, trajectory_size);
            }

            ismrmrd_cleanup_acquisition(&meta_acquisition);
        }

        status = ismrmrd_append_acquisition(&dest_writer->dataset, &acquisition);
        ismrmrd_cleanup_acquisition(&acquisition);
        if (status != ISMRMRD_NOERROR) {
            ismrmrdshim_capture_errors("failed to append acquisition");
            return status;
        }
    }

    return ISMRMRD_NOERROR;
}

static int ismrmrdshim_copy_dataset_internal(
    const char *source_filename,
    const char *source_groupname,
    const char *meta_filename,
    const char *meta_groupname,
    const char *dest_filename,
    const char *dest_groupname,
    const char *xmlstring) {
    ISMRMRD_WasmDatasetWriter *source_writer = NULL;
    ISMRMRD_WasmDatasetWriter *meta_writer = NULL;
    ISMRMRD_WasmDatasetWriter *dest_writer = NULL;
    char *header_copy = NULL;
    const char *header_to_write = xmlstring;
    int status = ISMRMRD_NOERROR;

    ismrmrdshim_clear_last_error();

    source_writer = ismrmrdshim_open_dataset_internal(source_filename, source_groupname, 0);
    if (source_writer == NULL) {
        return ISMRMRD_RUNTIMEERROR;
    }

    if (meta_filename != NULL && meta_groupname != NULL) {
        meta_writer = ismrmrdshim_open_dataset_internal(meta_filename, meta_groupname, 0);
        if (meta_writer == NULL) {
            status = ISMRMRD_RUNTIMEERROR;
            goto cleanup;
        }
    }

    dest_writer = ismrmrdshim_open_dataset_internal(dest_filename, dest_groupname, 1);
    if (dest_writer == NULL) {
        status = ISMRMRD_RUNTIMEERROR;
        goto cleanup;
    }

    if (header_to_write == NULL || header_to_write[0] == '\0') {
        if (meta_writer != NULL) {
            header_copy = ismrmrdshim_read_xml_header(&meta_writer->dataset);
        } else {
            header_copy = ismrmrdshim_read_xml_header(&source_writer->dataset);
        }
        if (header_copy == NULL) {
            status = ISMRMRD_RUNTIMEERROR;
            goto cleanup;
        }
        header_to_write = header_copy;
    }

    status = ismrmrd_write_header(&dest_writer->dataset, header_to_write);
    if (status != ISMRMRD_NOERROR) {
        ismrmrdshim_capture_errors("failed to write xml header");
        goto cleanup;
    }

    status = ismrmrdshim_copy_acquisitions(source_writer, meta_writer, dest_writer);
    if (status != ISMRMRD_NOERROR) {
        goto cleanup;
    }

    status = ismrmrdshim_copy_waveforms(source_writer, dest_writer);
    if (status != ISMRMRD_NOERROR) {
        goto cleanup;
    }

cleanup:
    free(header_copy);
    if (dest_writer != NULL) {
        if (status == ISMRMRD_NOERROR) {
            if (ismrmrdshim_close_dataset(dest_writer) != ISMRMRD_NOERROR) {
                status = ISMRMRD_RUNTIMEERROR;
            }
        }
        ismrmrdshim_destroy_dataset(dest_writer);
    }
    if (meta_writer != NULL) {
        ismrmrdshim_destroy_dataset(meta_writer);
    }
    if (source_writer != NULL) {
        ismrmrdshim_destroy_dataset(source_writer);
    }

    return status;
}

int ismrmrdshim_copy_dataset_with_header(
    const char *source_filename,
    const char *source_groupname,
    const char *dest_filename,
    const char *dest_groupname,
    const char *xmlstring) {
    return ismrmrdshim_copy_dataset_internal(
        source_filename,
        source_groupname,
        NULL,
        NULL,
        dest_filename,
        dest_groupname,
        xmlstring);
}

int ismrmrdshim_copy_dataset_with_meta(
    const char *source_filename,
    const char *source_groupname,
    const char *meta_filename,
    const char *meta_groupname,
    const char *dest_filename,
    const char *dest_groupname,
    const char *xmlstring) {
    return ismrmrdshim_copy_dataset_internal(
        source_filename,
        source_groupname,
        meta_filename,
        meta_groupname,
        dest_filename,
        dest_groupname,
        xmlstring);
}

const char *ismrmrdshim_get_last_error(void) {
    return ismrmrdshim_last_error;
}
