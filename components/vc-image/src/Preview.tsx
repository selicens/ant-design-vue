import {
  computed,
  defineComponent,
  onMounted,
  onUnmounted,
  reactive,
  shallowRef,
  watch,
  cloneVNode,
} from 'vue';
import type { VNode, PropType } from 'vue';

import classnames from '../../_util/classNames';
import Dialog from '../../vc-dialog';
import { type IDialogChildProps, dialogPropTypes } from '../../vc-dialog/IDialogPropTypes';
import { getOffset } from '../../vc-util/Dom/css';
import addEventListener from '../../vc-util/Dom/addEventListener';
import KeyCode from '../../_util/KeyCode';
import { warning } from '../../vc-util/warning';
import useFrameSetState from './hooks/useFrameSetState';
import getFixScaleEleTransPosition from './getFixScaleEleTransPosition';
import type { MouseEventHandler, WheelEventHandler } from '../../_util/EventInterface';
import type { CustomSlotsType } from '../../_util/type';

import { context } from './PreviewGroup';

export interface PreviewProps extends Omit<IDialogChildProps, 'onClose' | 'mask'> {
  onClose?: (e: Element) => void;
  src?: string;
  alt?: string;
  rootClassName?: string;
  icons?: {
    rotateLeft?: VNode;
    rotateRight?: VNode;
    zoomIn?: VNode;
    zoomOut?: VNode;
    close?: VNode;
    left?: VNode;
    right?: VNode;
    flipX?: VNode;
    flipY?: VNode;
  };
}

const initialPosition = {
  x: 0,
  y: 0,
};
export const previewProps = {
  ...dialogPropTypes(),
  src: String,
  alt: String,
  rootClassName: String,
  icons: {
    type: Object as PropType<PreviewProps['icons']>,
    default: () => ({} as PreviewProps['icons']),
  },
  minScale: Number,
  maxScale: Number,
};
const Preview = defineComponent({
  compatConfig: { MODE: 3 },
  name: 'Preview',
  inheritAttrs: false,
  props: previewProps,
  emits: ['close', 'afterClose'],
  slots: Object as CustomSlotsType<{
    closeIcon: any;
    countRender: any;
    toolbarRender: any;
  }>,
  setup(props, { emit, attrs, slots }) {
    const { rotateLeft, rotateRight, zoomIn, zoomOut, close, left, right, flipX, flipY } = reactive(
      props.icons,
    );

    const { minScale = 1, maxScale = 50 } = reactive(props);

    const scale = shallowRef(1);
    const rotate = shallowRef(0);
    const flip = reactive({ x: 1, y: 1 });
    const [position, setPosition] = useFrameSetState<{
      x: number;
      y: number;
    }>(initialPosition);

    const mousePosition = shallowRef({ x: 0, y: 0 });

    const updateMousePosition = (e: MouseEvent) => {
      mousePosition.value = {
        x: e.pageX,
        y: e.pageY,
      };
    };

    const onClose = () => emit('close');
    const imgRef = shallowRef<HTMLImageElement>();
    const originPositionRef = reactive<{
      originX: number;
      originY: number;
      deltaX: number;
      deltaY: number;
    }>({
      originX: 0,
      originY: 0,
      deltaX: 0,
      deltaY: 0,
    });
    const isMoving = shallowRef(false);
    const groupContext = context.inject();
    const { previewUrls, current, isPreviewGroup, setCurrent } = groupContext;
    const previewGroupCount = computed(() => previewUrls.value.size);
    const previewUrlsKeys = computed(() => Array.from(previewUrls.value.keys()));
    const currentPreviewIndex = computed(() => previewUrlsKeys.value.indexOf(current.value));
    const combinationSrc = computed(() => {
      return isPreviewGroup.value ? previewUrls.value.get(current.value) : props.src;
    });
    const showLeftOrRightSwitches = computed(
      () => isPreviewGroup.value && previewGroupCount.value > 1,
    );
    const showOperationsProgress = computed(
      () => isPreviewGroup.value && previewGroupCount.value >= 1,
    );
    const lastWheelZoomDirection = shallowRef({ wheelDirection: 0 });
    const lastZoomPosition = shallowRef({ x: 0, y: 0 });
    const hasWheelZoomed = shallowRef(false);

    const onAfterClose = () => {
      scale.value = 1;
      rotate.value = 0;
      flip.x = 1;
      flip.y = 1;
      setPosition(initialPosition);
      hasWheelZoomed.value = false;
      lastZoomPosition.value = { x: 0, y: 0 };
      emit('afterClose');
    };

    const dispatchZoomChange = (
      ratio: number,
      isWheel: boolean,
      centerX?: number,
      centerY?: number,
    ) => {
      const imgElement = imgRef.value;
      if (!imgElement) return;

      // 获取图片的尺寸和位置信息
      const { offsetWidth, offsetHeight, offsetLeft, offsetTop } = imgElement;

      // 计算新的缩放比例
      let newRatio = ratio;
      let newScale = scale.value * ratio;
      if (newScale > maxScale) {
        newScale = maxScale;
        newRatio = maxScale / scale.value;
      } else if (newScale < minScale) {
        // 对于滚轮缩放，允许缩小到最小比例
        newScale = minScale;
        newRatio = minScale / scale.value;
      }

      // 确定缩放中心点
      const mergedCenterX = centerX ?? window.innerWidth / 2;
      const mergedCenterY = centerY ?? window.innerHeight / 2;

      const diffRatio = newRatio - 1;
      // 基于图片尺寸计算偏移
      const diffImgX = diffRatio * offsetWidth * 0.5;
      const diffImgY = diffRatio * offsetHeight * 0.5;
      // 计算点击位置相对于图片边缘的偏移
      const diffOffsetLeft = diffRatio * (mergedCenterX - position.x - offsetLeft);
      const diffOffsetTop = diffRatio * (mergedCenterY - position.y - offsetTop);
      // 计算最终位置
      let newX = position.x - (diffOffsetLeft - diffImgX);
      let newY = position.y - (diffOffsetTop - diffImgY);

      // 当缩小到原始大小时，如果图片小于窗口，则居中显示
      if (ratio < 1 && newScale === 1) {
        const mergedWidth = offsetWidth * newScale;
        const mergedHeight = offsetHeight * newScale;
        const clientWidth = window.innerWidth;
        const clientHeight = window.innerHeight;
        if (mergedWidth <= clientWidth && mergedHeight <= clientHeight) {
          newX = 0;
          newY = 0;
          // 重置滚轮缩放状态
          if (!isWheel) {
            hasWheelZoomed.value = false;
            lastZoomPosition.value = { x: 0, y: 0 };
          }
        }
      }

      // 更新缩放比例和位置
      scale.value = newScale;
      setPosition({
        x: newX,
        y: newY,
      });
    };

    const onZoomIn = (isWheel = false) => {
      if (scale.value >= maxScale) {
        return;
      }

      if (isWheel) {
        // 使用鼠标位置作为缩放中心点
        dispatchZoomChange(1.5, true, mousePosition.value.x, mousePosition.value.y);
        // 记录最后一次滚轮缩放的位置
        lastZoomPosition.value = { x: mousePosition.value.x, y: mousePosition.value.y };
        hasWheelZoomed.value = true;
      } else {
        // 按钮缩放：如果之前使用过滚轮，则使用最后的滚轮位置，否则使用中心点
        if (hasWheelZoomed.value) {
          dispatchZoomChange(2, false, lastZoomPosition.value.x, lastZoomPosition.value.y);
        } else {
          dispatchZoomChange(2, false);
        }
      }
    };

    const onZoomOut = (isWheel = false) => {
      if (scale.value <= minScale) {
        // 当缩小到最小比例时，重置滚轮缩放状态
        hasWheelZoomed.value = false;
        lastZoomPosition.value = { x: 0, y: 0 };
        return;
      }

      if (isWheel) {
        // 使用鼠标位置作为缩放中心点
        dispatchZoomChange(0.667, true, mousePosition.value.x, mousePosition.value.y);
        // 记录最后一次滚轮缩放的位置
        lastZoomPosition.value = { x: mousePosition.value.x, y: mousePosition.value.y };
        hasWheelZoomed.value = true;
      } else {
        // 按钮缩放：如果之前使用过滚轮，则使用最后的滚轮位置，否则使用中心点
        if (hasWheelZoomed.value) {
          dispatchZoomChange(0.5, false, lastZoomPosition.value.x, lastZoomPosition.value.y);
        } else {
          dispatchZoomChange(0.5, false);
        }
      }
    };

    const onRotateRight = () => {
      rotate.value += 90;
    };

    const onRotateLeft = () => {
      rotate.value -= 90;
    };

    const onFlipX = () => {
      flip.x = -flip.x;
    };

    const onFlipY = () => {
      flip.y = -flip.y;
    };

    const onSwitchLeft: MouseEventHandler = event => {
      event.preventDefault();
      // Without this mask close will abnormal
      event.stopPropagation();
      if (currentPreviewIndex.value > 0) {
        setCurrent(previewUrlsKeys.value[currentPreviewIndex.value - 1]);
      }
    };

    const onSwitchRight: MouseEventHandler = event => {
      event.preventDefault();
      // Without this mask close will abnormal
      event.stopPropagation();
      if (currentPreviewIndex.value < previewGroupCount.value - 1) {
        setCurrent(previewUrlsKeys.value[currentPreviewIndex.value + 1]);
      }
    };

    const wrapClassName = classnames({
      [`${props.prefixCls}-moving`]: isMoving.value,
    });
    const toolClassName = `${props.prefixCls}-operations-operation`;
    const iconClassName = `${props.prefixCls}-operations-icon`;
    const tools = [
      {
        icon: flipY,
        onClick: () => onFlipY(),
        type: 'flipY',
      },
      {
        icon: flipX,
        onClick: () => onFlipX(),
        type: 'flipX',
      },
      {
        icon: rotateLeft,
        onClick: () => onRotateLeft(),
        type: 'rotateLeft',
      },
      {
        icon: rotateRight,
        onClick: () => onRotateRight(),
        type: 'rotateRight',
      },
      {
        icon: zoomOut,
        onClick: () => onZoomOut(),
        type: 'zoomOut',
        disabled: computed(() => scale.value === minScale),
      },
      {
        icon: zoomIn,
        onClick: () => onZoomIn(),
        type: 'zoomIn',
        disabled: computed(() => scale.value === maxScale),
      },
    ];

    const onMouseUp: MouseEventHandler = () => {
      if (props.visible && isMoving.value) {
        const width = imgRef.value.offsetWidth * scale.value;
        const height = imgRef.value.offsetHeight * scale.value;
        const { left, top } = getOffset(imgRef.value);
        const isRotate = rotate.value % 180 !== 0;

        isMoving.value = false;

        const fixState = getFixScaleEleTransPosition(
          isRotate ? height : width,
          isRotate ? width : height,
          left,
          top,
        );
        if (fixState) {
          setPosition({ ...fixState });
        }
      }
    };

    const onMouseDown: MouseEventHandler = event => {
      // Only allow main button
      if (event.button !== 0) return;
      event.preventDefault();
      // Without this mask close will abnormal
      event.stopPropagation();
      originPositionRef.deltaX = event.pageX - position.x;
      originPositionRef.deltaY = event.pageY - position.y;
      originPositionRef.originX = position.x;
      originPositionRef.originY = position.y;
      isMoving.value = true;
    };

    const onMouseMove: MouseEventHandler = event => {
      updateMousePosition(event);
      if (props.visible && isMoving.value) {
        setPosition({
          x: event.pageX - originPositionRef.deltaX,
          y: event.pageY - originPositionRef.deltaY,
        });
      }
    };

    const onWheelMove: WheelEventHandler = event => {
      if (!props.visible) return;
      event.preventDefault();
      const wheelDirection = event.deltaY;
      lastWheelZoomDirection.value = { wheelDirection };
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.visible || !showLeftOrRightSwitches.value) return;

      event.preventDefault();
      if (event.keyCode === KeyCode.LEFT) {
        if (currentPreviewIndex.value > 0) {
          setCurrent(previewUrlsKeys.value[currentPreviewIndex.value - 1]);
        }
      } else if (event.keyCode === KeyCode.RIGHT) {
        if (currentPreviewIndex.value < previewGroupCount.value - 1) {
          setCurrent(previewUrlsKeys.value[currentPreviewIndex.value + 1]);
        }
      }
    };

    const onDoubleClick = () => {
      if (props.visible) {
        if (scale.value !== 1) {
          scale.value = 1;
        }
        if (position.x !== initialPosition.x || position.y !== initialPosition.y) {
          setPosition(initialPosition);
        }
      }
    };

    let removeListeners = () => {};
    onMounted(() => {
      watch(
        [() => props.visible, isMoving],
        () => {
          removeListeners();
          let onTopMouseUpListener: { remove: any };
          let onTopMouseMoveListener: { remove: any };

          const onMouseUpListener = addEventListener(window, 'mouseup', onMouseUp, false);
          const onMouseMoveListener = addEventListener(window, 'mousemove', onMouseMove, false);
          const onKeyDownListener = addEventListener(window, 'keydown', onKeyDown, false);

          try {
            // Resolve if in iframe lost event
            /* istanbul ignore next */
            if (window.top !== window.self) {
              onTopMouseUpListener = addEventListener(window.top, 'mouseup', onMouseUp, false);
              onTopMouseMoveListener = addEventListener(
                window.top,
                'mousemove',
                onMouseMove,
                false,
              );
            }
          } catch (error) {
            /* istanbul ignore next */
            warning(false, `[vc-image] ${error}`);
          }

          removeListeners = () => {
            onMouseUpListener.remove();
            onMouseMoveListener.remove();
            onKeyDownListener.remove();

            /* istanbul ignore next */
            if (onTopMouseUpListener) onTopMouseUpListener.remove();
            /* istanbul ignore next */
            if (onTopMouseMoveListener) onTopMouseMoveListener.remove();
          };
        },
        { flush: 'post', immediate: true },
      );
      watch([lastWheelZoomDirection], () => {
        const { wheelDirection } = lastWheelZoomDirection.value;
        if (wheelDirection > 0) {
          onZoomOut(true);
        } else if (wheelDirection < 0) {
          onZoomIn(true);
        }
      });
    });
    onUnmounted(() => {
      removeListeners();
    });

    return () => {
      const { visible, prefixCls, rootClassName } = props;

      const toolsNode = tools.map(({ icon: IconType, onClick, type, disabled }) => (
        <div
          class={classnames(toolClassName, {
            [`${props.prefixCls}-operations-operation-${type}`]: true,
            [`${props.prefixCls}-operations-operation-disabled`]: disabled && disabled?.value,
          })}
          onClick={onClick}
          key={type}
        >
          {cloneVNode(IconType, { class: iconClassName })}
        </div>
      ));

      const toolbarNode = <div class={`${props.prefixCls}-operations`}>{toolsNode}</div>;

      return (
        <>
          <Dialog
            {...attrs}
            transitionName={props.transitionName}
            maskTransitionName={props.maskTransitionName}
            closable={false}
            keyboard
            prefixCls={prefixCls}
            onClose={onClose}
            afterClose={onAfterClose}
            visible={visible}
            wrapClassName={wrapClassName}
            rootClassName={rootClassName}
            getContainer={props.getContainer}
          >
            <div
              class={`${props.prefixCls}-img-wrapper`}
              style={{
                transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
              }}
            >
              <img
                onMousedown={onMouseDown}
                onDblclick={onDoubleClick}
                onWheel={onWheelMove}
                ref={imgRef}
                class={`${props.prefixCls}-img`}
                src={combinationSrc.value}
                alt={props.alt}
                style={{
                  transform: `scale3d(${flip.x * scale.value}, ${flip.y * scale.value}, 1) rotate(${
                    rotate.value
                  }deg)`,
                }}
              />
            </div>
          </Dialog>
          {visible && (
            <div class={classnames(`${props.prefixCls}-operations-wrapper`, rootClassName)}>
              <button class={`${props.prefixCls}-close`} onClick={onClose}>
                {slots.closeIcon?.({ onClose }) || close}
              </button>

              {showLeftOrRightSwitches.value && (
                <>
                  <div
                    class={classnames(`${prefixCls}-switch-left`, {
                      [`${props.prefixCls}-switch-left-disabled`]: currentPreviewIndex.value === 0,
                    })}
                    onClick={onSwitchLeft}
                  >
                    {left}
                  </div>
                  <div
                    class={classnames(`${prefixCls}-switch-right`, {
                      [`${props.prefixCls}-switch-right-disabled`]:
                        currentPreviewIndex.value === previewGroupCount.value - 1,
                    })}
                    onClick={onSwitchRight}
                  >
                    {right}
                  </div>
                </>
              )}

              <div class={[`${props.prefixCls}-footer`]}>
                {showOperationsProgress.value && (
                  <div class={`${props.prefixCls}-progress`}>
                    {`${currentPreviewIndex.value + 1} / ${previewGroupCount.value}`}
                  </div>
                )}
                {slots.toolbarRender
                  ? slots.toolbarRender?.({
                      actions: {
                        onFlipY,
                        onFlipX,
                        onRotateLeft,
                        onRotateRight,
                        onZoomOut,
                        onZoomIn,
                      },
                      transform: {
                        x: position.x,
                        y: position.y,
                        scale: scale.value,
                        rotate,
                        flip,
                      },
                      ...(groupContext
                        ? { current: currentPreviewIndex.value, total: previewGroupCount.value }
                        : {}),
                    })
                  : toolbarNode}
              </div>
            </div>
          )}
        </>
      );
    };
  },
});

export default Preview;
