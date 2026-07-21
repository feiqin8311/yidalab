import { type SliderWithInputProps } from '@lobehub/ui';
import { SliderWithInput } from '@lobehub/ui';
import { debounce } from 'es-toolkit/compat';
import { memo, useEffect, useMemo, useState } from 'react';

interface FormSliderWithInputProps extends Omit<SliderWithInputProps, 'onChange' | 'value'> {
  onChange?: (value: number) => void;
  value?: number;
}

/**
 * Form-integrated slider. Debounces onChange so drag doesn't spam saves;
 * slider drag-end / input changes both commit (blur-only never fired for Slider).
 */
const FormSliderWithInput = memo<FormSliderWithInputProps>(
  ({ onChange, value: defaultValue, ...props }) => {
    const [value, setValue] = useState(defaultValue ?? 0);

    useEffect(() => {
      setValue(defaultValue ?? 0);
    }, [defaultValue]);

    const commit = useMemo(
      () =>
        debounce((next: number) => {
          onChange?.(next);
        }, 200),
      [onChange],
    );

    useEffect(() => () => commit.flush(), [commit]);

    return (
      <SliderWithInput
        {...props}
        value={value}
        onChange={(newValue) => {
          if (typeof newValue !== 'number') return;
          setValue(newValue);
          commit(newValue);
        }}
        onChangeComplete={(newValue) => {
          if (typeof newValue !== 'number') return;
          commit.cancel();
          setValue(newValue);
          onChange?.(newValue);
        }}
      />
    );
  },
);

FormSliderWithInput.displayName = 'FormSliderWithInput';

export default FormSliderWithInput;
