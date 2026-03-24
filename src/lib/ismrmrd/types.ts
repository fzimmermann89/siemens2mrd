export interface EncodingCounters {
  kspace_encode_step_1: number;
  kspace_encode_step_2: number;
  average: number;
  slice: number;
  contrast: number;
  phase: number;
  repetition: number;
  set: number;
  segment: number;
  user: number[];
}

export interface IsmrmrdAcquisitionHeaderLike {
  version: number;
  flags: bigint;
  measurement_uid: number;
  scan_counter: number;
  acquisition_time_stamp: number;
  physiology_time_stamp: number[];
  number_of_samples: number;
  available_channels: number;
  active_channels: number;
  channel_mask: bigint[];
  discard_pre: number;
  discard_post: number;
  center_sample: number;
  encoding_space_ref: number;
  trajectory_dimensions: number;
  sample_time_us: number;
  position: number[];
  read_dir: number[];
  phase_dir: number[];
  slice_dir: number[];
  patient_table_position: number[];
  idx: EncodingCounters;
  user_int: number[];
  user_float: number[];
}

export interface IsmrmrdAcquisitionLike {
  head: IsmrmrdAcquisitionHeaderLike;
  traj: Float32Array;
  data: Float32Array;
}

export interface IsmrmrdWaveformHeaderLike {
  version: number;
  flags: bigint;
  measurement_uid: number;
  scan_counter: number;
  time_stamp: number;
  number_of_samples: number;
  channels: number;
  sample_time_us: number;
  waveform_id: number;
}

export interface IsmrmrdWaveformLike {
  head: IsmrmrdWaveformHeaderLike;
  data: Uint32Array;
}

export interface ConversionResult<Measurement> {
  measurement: Measurement;
  acquisitions: IsmrmrdAcquisitionLike[];
  waveforms: IsmrmrdWaveformLike[];
}
