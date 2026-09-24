/**
 * Choosing files, and being shown that you did.
 *
 * This component exists because the same picker was hand-written four times and all
 * four were broken in the same way: they read `e.target.files` inside a setState
 * updater, which React runs during a later render, AFTER the next line had cleared the
 * input. Nothing was ever attached. Clearing the input also wipes the native
 * "1 file selected" text, so there was no feedback to contradict it either.
 *
 * These pin the CONTRACT that makes that impossible — onChange receives a resolved
 * array, and the component owns the input — plus the feedback that would have made the
 * original obvious. They do not reproduce the old bug itself: it lived in how callers
 * used a raw input, and this component removes the opportunity rather than guarding
 * against it. The guard against regressing to the old shape is that no page owns a file
 * input any more.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import AttachmentPicker from '../../Components/ESF/AttachmentPicker.jsx';

const file = (name, type = 'application/pdf', size = 2048) => {
    const f = new File(['x'.repeat(8)], name, { type });
    // jsdom derives size from content; override so the label can be asserted.
    Object.defineProperty(f, 'size', { value: size });
    return f;
};

beforeEach(() => {
    // jsdom has no object-URL implementation, and the component revokes what it creates.
    global.URL.createObjectURL = vi.fn(() => 'blob:preview');
    global.URL.revokeObjectURL = vi.fn();
});

const pickerInput = () => document.querySelector('input[type="file"]');

describe('the contract that makes the original bug impossible', () => {
    it('hands back a resolved array, not something to be read later', async () => {
        // The old call sites deferred the read into a setState updater and found the
        // input already cleared. Resolving here is what removes that possibility.
        const onChange = vi.fn();
        render(<AttachmentPicker files={[]} onChange={onChange} />);

        await userEvent.upload(pickerInput(), file('brief.pdf'));

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toHaveLength(1);
        expect(onChange.mock.calls[0][0][0].name).toBe('brief.pdf');
    });

    it('clears the input, so the same file can be chosen twice', async () => {
        // Why the clearing existed in the first place: without it, re-picking an
        // identical file fires no change event at all.
        const onChange = vi.fn();
        render(<AttachmentPicker files={[]} onChange={onChange} />);

        const input = pickerInput();
        await userEvent.upload(input, file('brief.pdf'));

        expect(input.value).toBe('');
    });
});

describe('showing what was chosen', () => {
    it('renders an image as an actual thumbnail', async () => {
        // The point of the whole component: seeing the picture is what proves the
        // upload took.
        render(<AttachmentPicker files={[file('shelf.png', 'image/png')]} onChange={vi.fn()} />);

        const thumb = document.querySelector('img');
        expect(thumb).toBeTruthy();
        expect(thumb.getAttribute('src')).toBe('blob:preview');
    });

    it('renders a non-image with its name and size instead', async () => {
        render(<AttachmentPicker files={[file('brief.pdf', 'application/pdf', 3 * 1048576)]} onChange={vi.fn()} />);

        expect(screen.getByText('brief.pdf')).toBeInTheDocument();
        expect(screen.getByText('3.0 MB')).toBeInTheDocument();
        expect(document.querySelector('img')).toBeNull();
    });

    it('says how many of the limit are used', async () => {
        render(<AttachmentPicker files={[file('a.pdf'), file('b.pdf')]} onChange={vi.fn()} max={5} />);

        expect(screen.getByText('2 of 5')).toBeInTheDocument();
    });

    it('states the limit before anything is chosen', async () => {
        render(<AttachmentPicker files={[]} onChange={vi.fn()} max={5} />);

        expect(screen.getByText('Up to 5 files')).toBeInTheDocument();
    });
});

describe('removing and limits', () => {
    it('removes the one that was clicked, not the first', async () => {
        const onChange = vi.fn();
        render(<AttachmentPicker files={[file('a.pdf'), file('b.pdf'), file('c.pdf')]} onChange={onChange} />);

        const removeButtons = screen.getAllByTitle('Remove');
        await userEvent.click(removeButtons[1]);

        expect(onChange.mock.calls[0][0].map((f) => f.name)).toEqual(['a.pdf', 'c.pdf']);
    });

    it('never hands back more than the cap', async () => {
        // Capped client-side too, so picking ten says so now rather than after the
        // upload has finished.
        const onChange = vi.fn();
        render(<AttachmentPicker files={[file('a.pdf'), file('b.pdf')]} onChange={onChange} max={3} />);

        await userEvent.upload(pickerInput(), [file('c.pdf'), file('d.pdf'), file('e.pdf')]);

        expect(onChange.mock.calls[0][0]).toHaveLength(3);
    });

    it('disables the trigger once the cap is reached', async () => {
        render(<AttachmentPicker files={[file('a.pdf'), file('b.pdf')]} onChange={vi.fn()} max={2} />);

        expect(pickerInput()).toBeDisabled();
    });
});

describe('object URLs', () => {
    it('revokes every preview it created when unmounted', async () => {
        // Otherwise each image a client previews stays in memory for the life of the
        // page — and this is a form people retry.
        const { unmount } = render(
            <AttachmentPicker files={[file('a.png', 'image/png')]} onChange={vi.fn()} />
        );

        unmount();

        expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    });
});
